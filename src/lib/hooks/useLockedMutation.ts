import {
	type QueryClient,
	type QueryKey,
	useMutation,
} from "@tanstack/react-query";
import { useCallback } from "react";
import { toast } from "sonner";
import { captureRouteError } from "@/lib/observability/sentry";

/**
 * App-wide deep-mutation seam (architecture review 2026-07-02, #2). Before this
 * module every write was a hand-rolled `if (!lock()) return; try { await
 * serverFn(); ...} catch { release(); }` block, repeated across match.tsx with
 * a silent `catch {}` swallowing failures. This wraps `useMutation` with the
 * app's cross-cutting write policy in one place: optional navigation lock,
 * typed-result classification (success / stale-reconcile / retryable-failure),
 * query invalidation as declared policy, and toast + Sentry surfacing on thrown
 * errors — so call sites declare *what* a write does, not the plumbing.
 *
 * Kept deliberately unopinionated about *how* a result is classified — servers
 * in this codebase disagree on shape (typed `{success:false}` unions, action-
 * status tokens, raw throws — see architecture review #1). `isSuccess` and
 * `isStale` let each call site supply its own classifier without this module
 * assuming a single envelope.
 */
export interface UseLockedMutationOptions<TVariables, TResult> {
	/** Sentry `operation` tag + fallback identifier for telemetry. */
	operation: string;
	mutationFn: (variables: TVariables) => Promise<TResult>;
	/**
	 * Returns `false` (without running the mutation) if a write is already in
	 * flight. Omit for mutations that don't participate in a shared navigation
	 * lock (e.g. a standalone card action) — the run then always proceeds.
	 */
	onLockNavigation?: () => boolean;
	/**
	 * Released on: a retryable failure (isSuccess false, isStale false/absent),
	 * or a thrown error. NOT released automatically on success or on a stale
	 * result — those cases typically transition the UI (e.g. advance to the next
	 * card) through their own effect, which is where callers should release.
	 */
	onReleaseNavigation?: () => void;
	/**
	 * Release the lock on a success result too (default: false — success paths
	 * typically transition the UI through their own effect, e.g. an itemId
	 * change, which releases instead). Set true for actions with no such
	 * transition (nothing else releases the lock).
	 */
	releaseOnSuccess?: boolean;
	/** Same as `releaseOnSuccess`, for stale results. Default: false. */
	releaseOnStale?: boolean;
	/** Defaults to `() => true` — every resolved result counts as success. */
	isSuccess?: (result: TResult) => boolean;
	/**
	 * A failure that means "this client's view is stale" (e.g. the server
	 * already resolved the item from another tab) rather than a real error.
	 * Stale results skip the toast/release and are handed to `onStale` so the
	 * caller can reconcile instead of retrying into the same rejection.
	 */
	isStale?: (result: TResult) => boolean;
	onSuccess?: (result: TResult, variables: TVariables) => void | Promise<void>;
	onStale?: (result: TResult, variables: TVariables) => void | Promise<void>;
	/** Called for a classified (non-thrown) retryable failure, after release. */
	onRetryableFailure?: (result: TResult, variables: TVariables) => void;
	/**
	 * Query keys to invalidate after a successful (non-stale) write. Declared
	 * here — not scattered at call sites — so invalidation is part of the
	 * mutation's contract. Can depend on the result/variables.
	 */
	invalidateKeys?:
		| QueryKey[]
		| ((result: TResult, variables: TVariables) => QueryKey[]);
	/** Toast copy shown when the mutation throws. */
	errorMessage?: string;
}

const DEFAULT_ERROR_MESSAGE = "Something went wrong. Please try again.";

/**
 * useMutation wrapper implementing the app's deep write policy. See module
 * doc comment for rationale. First generalized adoption of `useMutation` in
 * the repo alongside `dismissSuggestionMutation`
 * (src/features/matching/mutations.ts), which stays a bespoke optimistic
 * factory — this module is for the lock → write → classify → invalidate shape
 * instead.
 */
export function useLockedMutation<TVariables, TResult>(
	queryClient: QueryClient,
	options: UseLockedMutationOptions<TVariables, TResult>,
) {
	const {
		operation,
		mutationFn,
		onLockNavigation,
		onReleaseNavigation,
		releaseOnSuccess = false,
		releaseOnStale = false,
		isSuccess = () => true,
		isStale,
		onSuccess,
		onStale,
		onRetryableFailure,
		invalidateKeys,
		errorMessage = DEFAULT_ERROR_MESSAGE,
	} = options;

	const mutation = useMutation({ mutationFn });

	const run = useCallback(
		async (variables: TVariables): Promise<TResult | undefined> => {
			if (onLockNavigation && !onLockNavigation()) return undefined;

			try {
				const result = await mutation.mutateAsync(variables);

				if (isSuccess(result)) {
					const keys =
						typeof invalidateKeys === "function"
							? invalidateKeys(result, variables)
							: invalidateKeys;
					if (keys?.length) {
						await Promise.all(
							keys.map((queryKey) =>
								queryClient.invalidateQueries({ queryKey }),
							),
						);
					}
					if (releaseOnSuccess) onReleaseNavigation?.();
					await onSuccess?.(result, variables);
					return result;
				}

				if (isStale?.(result)) {
					if (releaseOnStale) onReleaseNavigation?.();
					await onStale?.(result, variables);
					return result;
				}

				onReleaseNavigation?.();
				onRetryableFailure?.(result, variables);
				return result;
			} catch (error) {
				onReleaseNavigation?.();
				captureRouteError(error, { operation });
				toast.error(errorMessage);
				return undefined;
			}
		},
		[
			mutation,
			onLockNavigation,
			onReleaseNavigation,
			releaseOnSuccess,
			releaseOnStale,
			isSuccess,
			isStale,
			onSuccess,
			onStale,
			onRetryableFailure,
			invalidateKeys,
			queryClient,
			operation,
			errorMessage,
		],
	);

	return { run, isPending: mutation.isPending };
}
