/**
 * Claim handle step — the one onboarding step that uses a semantic <form>
 * instead of the global `useShortcut("enter")` pattern, because the keyboard
 * provider suppresses shortcuts while focus is inside an <input>.
 *
 * Three distinct concepts drive the state machine:
 *   1. localFormatResult — output of validateHandleFormatInput on the current value
 *   2. availabilityVerdict — the latest authoritative server result for the debounced value
 *   3. isOwnedHandleState — whether claimHandleSeed.kind === "owned" and the
 *      current field value still exactly matches the seed handle
 *
 * Continue is actionable-only: enabled only when owned-equal OR
 * (format-valid + not-reserved + latest verdict === "available" + not submitting).
 */

import { ArrowRightIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { resolveSession } from "@/features/onboarding/step-resolver";
import { getPublicAppOrigin } from "@/lib/config/public-app-origin";
import type { ClaimHandleSeed } from "@/lib/domains/library/accounts/claim-handle-seed";
import type { HandleValidationReason } from "@/lib/domains/library/accounts/handle-rules";
import {
	isReservedHandle,
	validateHandleFormatInput,
} from "@/lib/domains/library/accounts/handle-rules";
import {
	checkHandleAvailability,
	claimHandleAndAdvance,
} from "@/lib/server/account-handle.functions";
import { fonts } from "@/lib/theme/fonts";

// ── Types ─────────────────────────────────────────────────────────────────────

type AvailabilityVerdict =
	| { status: "available" }
	| { status: "unavailable"; reason: HandleValidationReason }
	| { status: "error" }
	| null;

interface ClaimHandleStepProps {
	accountId: string;
	claimHandleSeed: ClaimHandleSeed;
}

// ── Copy helpers ───────────────────────────────────────────────────────────────

function reasonCopy(reason: HandleValidationReason): string {
	switch (reason) {
		case "empty":
			return "Enter a handle to continue.";
		case "contains_at_sign":
			return "Don’t include @ — it’s added to your public URL.";
		case "invalid_chars":
			return "Use only letters, numbers, periods, or underscores.";
		case "leading_period":
			return "Periods can’t start a username.";
		case "trailing_period":
			return "Periods can’t end a username.";
		case "consecutive_periods":
			return "Periods can’t appear twice in a row.";
		case "too_long":
			return "Handles can be up to 30 characters.";
		case "reserved":
			return "That handle is reserved.";
		case "profanity":
			return "That handle isn’t allowed.";
		case "taken":
			return "That handle is taken.";
	}
}

// ── Debounce hook ──────────────────────────────────────────────────────────────

function useDebounce<T>(value: T, delayMs: number): T {
	const [debounced, setDebounced] = useState<T>(value);
	useEffect(() => {
		const id = setTimeout(() => setDebounced(value), delayMs);
		return () => clearTimeout(id);
	}, [value, delayMs]);
	return debounced;
}

// ── Focus helper ───────────────────────────────────────────────────────────────

function focusInputAtEnd(input: HTMLInputElement | null) {
	if (!input) return;
	input.focus();
	const len = input.value.length;
	input.setSelectionRange(len, len);
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ClaimHandleStep({
	accountId,
	claimHandleSeed,
}: ClaimHandleStepProps) {
	const router = useRouter();
	const queryClient = useQueryClient();
	const inputRef = useRef<HTMLInputElement>(null);

	// Derived initial value from seed
	const initialValue =
		claimHandleSeed.kind === "blank" ? "" : claimHandleSeed.handle;

	const [value, setValue] = useState(initialValue);
	const [isSubmitting, setIsSubmitting] = useState(false);

	// When submit is in flight, we freeze the field readOnly and disable
	// new availability checks until the request settles.
	const [submitInFlight, setSubmitInFlight] = useState(false);

	// Submit-time unavailable verdict — overrides the query result as the
	// authoritative current-value verdict once returned by claimHandleAndAdvance.
	const [submitTimeUnavailable, setSubmitTimeUnavailable] =
		useState<HandleValidationReason | null>(null);

	// ── Owned-handle logic ────────────────────────────────────────────────────

	const ownedHandleSnapshot =
		claimHandleSeed.kind === "owned" ? claimHandleSeed.handle : null;

	// True only when the seed is "owned" and the field still holds the exact owned value.
	const isOwnedHandleState =
		claimHandleSeed.kind === "owned" && value === claimHandleSeed.handle;

	// True when seed is "owned" but the user has edited away from the seed value.
	const isEditedAwayFromOwned =
		claimHandleSeed.kind === "owned" && !isOwnedHandleState;

	// ── Local format validation ───────────────────────────────────────────────

	const formatResult = validateHandleFormatInput(value);
	const isFormatValid = formatResult.status === "valid";
	const formatReason =
		formatResult.status === "invalid" ? formatResult.reason : null;

	// Normalized handle only exists when format is valid.
	const normalizedHandle =
		formatResult.status === "valid" ? formatResult.normalizedHandle : null;

	// Locally reserved check (only when format is valid).
	const isLocallyReserved =
		isFormatValid &&
		normalizedHandle !== null &&
		isReservedHandle(normalizedHandle);

	// ── Debounced availability query ──────────────────────────────────────────

	// We debounce the value that drives the React Query key so:
	//   • Typing doesn't fire requests until the user pauses 250ms
	//   • The gcTime:0 + fresh key ensures edit-away-then-back forces a live check
	const debouncedValue = useDebounce(value, 250);

	// Only the debounced value that is ALSO format-valid, not locally reserved,
	// not owned-seed, and not submit-in-flight should trigger a query.
	const debouncedFormatResult = validateHandleFormatInput(debouncedValue);
	const debouncedIsFormatValid = debouncedFormatResult.status === "valid";
	const debouncedNormalized =
		debouncedFormatResult.status === "valid"
			? debouncedFormatResult.normalizedHandle
			: null;
	const debouncedIsLocallyReserved =
		debouncedIsFormatValid &&
		debouncedNormalized !== null &&
		isReservedHandle(debouncedNormalized);

	// The query fires when:
	//   • not owned-seed (owned seed never checks availability)
	//   • debounced value is format-valid
	//   • debounced value is not locally reserved
	//   • submit is not in flight (to avoid late responses overwriting submit UI)
	const queryEnabled =
		claimHandleSeed.kind !== "owned" &&
		debouncedIsFormatValid &&
		!debouncedIsLocallyReserved &&
		debouncedValue.length > 0 &&
		!submitInFlight;

	// Query key includes ownedHandleSnapshot so that if the account later claims
	// a handle and the same-session session cache is updated, the key changes and
	// a fresh check occurs rather than serving a stale "available" result.
	const availabilityQueryKey = [
		"onboarding",
		"handle-availability",
		accountId,
		ownedHandleSnapshot,
		// Use the debounced value here so the query key only changes after the
		// 250ms debounce period, not on every keystroke.
		debouncedValue,
	] as const;

	const availabilityQuery = useQuery({
		queryKey: availabilityQueryKey,
		queryFn: () =>
			checkHandleAvailability({ data: { handle: debouncedValue } }),
		enabled: queryEnabled,
		retry: false,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		gcTime: 0,
		// staleTime: 0 ensures edit-away-then-back always re-fetches, not returning
		// a cached result for the same handle string.
		staleTime: 0,
	});

	// ── Verdict derivation ────────────────────────────────────────────────────

	// The current-value verdict for the LIVE input (not debounced).
	// Rules:
	//   • If the live value differs from the debounced value, we're in the
	//     debounce gap — no verdict yet, clear old one.
	//   • If submit returned unavailable for this exact value, that overrides.
	//   • Otherwise use the React Query result if it matches the live value.
	const isInDebouncedGap = value !== debouncedValue;

	let currentVerdict: AvailabilityVerdict = null;

	if (!isOwnedHandleState && !isEditedAwayFromOwned) {
		if (submitTimeUnavailable !== null && !isInDebouncedGap) {
			// Submit-time unavailable is authoritative until the user edits.
			currentVerdict = { status: "unavailable", reason: submitTimeUnavailable };
		} else if (!isInDebouncedGap && queryEnabled && availabilityQuery.data) {
			// Use React Query data only when the debounced value matches the live value.
			const data = availabilityQuery.data;
			if (data.status === "available") {
				currentVerdict = { status: "available" };
			} else if (data.status === "unavailable") {
				currentVerdict = { status: "unavailable", reason: data.reason };
			} else if (data.status === "error") {
				currentVerdict = { status: "error" };
			}
			// "already_owned" during availability is handled in the effect below.
		} else if (
			!isInDebouncedGap &&
			queryEnabled &&
			availabilityQuery.isLoading
		) {
			// Query is in-flight — "checking" state (null verdict, checking handled
			// by availabilityQuery.isFetching).
			currentVerdict = null;
		}
	}

	const isChecking =
		!isInDebouncedGap &&
		queryEnabled &&
		(availabilityQuery.isFetching || availabilityQuery.isLoading);

	// ── Handle availability-time already_owned as immediate recovery ──────────

	useEffect(() => {
		if (!availabilityQuery.data) return;
		const data = availabilityQuery.data;
		if (data.status !== "already_owned") return;

		// Availability returned already_owned — patch both caches and navigate.
		// This is authoritative stale-state correction, not a validation error.
		queryClient.setQueryData(["auth", "onboarding-session"], data.onboarding);
		queryClient.setQueryData(["auth", "session"], (prev: unknown) => {
			if (!prev || typeof prev !== "object") return prev;
			const p = prev as { account?: Record<string, unknown> };
			return {
				...p,
				account: {
					...p.account,
					handle: data.ownedHandle,
				},
			};
		});

		const { allowedPath } = resolveSession(data.onboarding.session);
		if (allowedPath === "/onboarding") {
			router.navigate({
				to: "/onboarding",
				search: { step: data.onboarding.session.status },
			});
		} else {
			router.navigate({ to: allowedPath });
		}
	}, [availabilityQuery.data, queryClient, router]);

	// ── CTA gating ────────────────────────────────────────────────────────────

	// Continue enables only when:
	//   (owned-handle state AND not submitting)
	//   OR (format-valid + not-reserved + latest verdict available + not submitting)
	const canContinue =
		!isSubmitting &&
		(isOwnedHandleState ||
			(isFormatValid &&
				!isLocallyReserved &&
				currentVerdict?.status === "available"));

	// ── Input change handler ──────────────────────────────────────────────────

	const handleChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			if (submitInFlight) return;
			// Live-lowercase; preserve all other chars exactly (no slugification).
			const lowered = e.target.value.toLowerCase();
			setValue(lowered);
			// Clear any submit-time unavailable verdict as soon as the user edits.
			setSubmitTimeUnavailable(null);
		},
		[submitInFlight],
	);

	// ── Reset (owned-edited-away → restore owned handle) ─────────────────────

	const handleReset = useCallback(() => {
		if (claimHandleSeed.kind !== "owned") return;
		setValue(claimHandleSeed.handle);
		setSubmitTimeUnavailable(null);
		// Return focus to the input with caret at end.
		requestAnimationFrame(() => focusInputAtEnd(inputRef.current));
	}, [claimHandleSeed]);

	// ── Retry availability ────────────────────────────────────────────────────

	const handleRetry = useCallback(async () => {
		// Bypass debounce: force refetch for the current visible value immediately.
		await availabilityQuery.refetch();
		// Once settled, return focus to the input with caret at end.
		focusInputAtEnd(inputRef.current);
	}, [availabilityQuery]);

	// ── Submit ────────────────────────────────────────────────────────────────

	const handleSubmit = useCallback(
		async (e: React.FormEvent<HTMLFormElement>) => {
			e.preventDefault();

			// Branch by submit-state — one explicit path.

			// Owned-handle edited away → no-op (keep value, keep reminder visible).
			if (isEditedAwayFromOwned) return;

			// Blank, format-invalid, or locally reserved → defensive no-op.
			if (!isFormatValid || isLocallyReserved) return;

			// No current-value verdict yet (debounce gap, checking) → no-op.
			if (!isOwnedHandleState && !currentVerdict) return;
			if (!isOwnedHandleState && isChecking) return;

			// Availability error → keep existing retry state; don't submit.
			if (currentVerdict?.status === "error") return;

			// Not available and not owned-equal → no-op.
			if (!isOwnedHandleState && currentVerdict?.status !== "available") return;

			// ── Real claim branch ────────────────────────────────────────────────

			const submittedHandle = value; // snapshot before any state change
			setSubmitInFlight(true);
			setIsSubmitting(true);

			let result: Awaited<ReturnType<typeof claimHandleAndAdvance>>;
			try {
				result = await claimHandleAndAdvance({
					data: { handle: submittedHandle },
				});
			} catch {
				// Operational failure — toast and restore editability.
				toast.error("Couldn’t save your handle. Please try again.");
				setSubmitInFlight(false);
				setIsSubmitting(false);
				requestAnimationFrame(() => focusInputAtEnd(inputRef.current));
				return;
			}

			// Handle each result branch.

			if (result.status === "not_ready") {
				// Out-of-order stale-client path. Patch onboarding-session only.
				queryClient.setQueryData(
					["auth", "onboarding-session"],
					result.onboarding,
				);
				const { allowedPath } = resolveSession(result.onboarding.session);
				if (allowedPath === "/onboarding") {
					router.navigate({
						to: "/onboarding",
						search: { step: result.onboarding.session.status },
					});
				} else {
					router.navigate({ to: allowedPath });
				}
				return;
			}

			if (result.status === "already_owned") {
				// Stale-tab submit for a different already-owned handle.
				// Patch both caches with the authoritative owned handle.
				queryClient.setQueryData(
					["auth", "onboarding-session"],
					result.onboarding,
				);
				queryClient.setQueryData(["auth", "session"], (prev: unknown) => {
					if (!prev || typeof prev !== "object") return prev;
					const p = prev as { account?: Record<string, unknown> };
					return {
						...p,
						account: {
							...p.account,
							handle: result.ownedHandle,
						},
					};
				});
				const { allowedPath } = resolveSession(result.onboarding.session);
				if (allowedPath === "/onboarding") {
					router.navigate({
						to: "/onboarding",
						search: { step: result.onboarding.session.status },
					});
				} else {
					router.navigate({ to: allowedPath });
				}
				return;
			}

			if (result.status === "claimed") {
				// Successful claim — patch both caches.
				queryClient.setQueryData(
					["auth", "onboarding-session"],
					result.onboarding,
				);
				// Preserve session + identity; replace only account.handle.
				queryClient.setQueryData(["auth", "session"], (prev: unknown) => {
					if (!prev || typeof prev !== "object") return prev;
					const p = prev as { account?: Record<string, unknown> };
					return {
						...p,
						account: {
							...p.account,
							handle: result.ownedHandle,
						},
					};
				});
				const { allowedPath } = resolveSession(result.onboarding.session);
				if (allowedPath === "/onboarding") {
					router.navigate({
						to: "/onboarding",
						search: { step: result.onboarding.session.status },
					});
				} else {
					router.navigate({ to: allowedPath });
				}
				return;
			}

			if (result.status === "unavailable") {
				// Submit-time unavailable — becomes the authoritative verdict for this value.
				// Drive the dynamic region from reason; hide preview; keep user on step.
				setSubmitTimeUnavailable(result.reason);
				setSubmitInFlight(false);
				setIsSubmitting(false);
				requestAnimationFrame(() => focusInputAtEnd(inputRef.current));
				return;
			}

			// Fallback: unexpected result — restore editability.
			setSubmitInFlight(false);
			setIsSubmitting(false);
			requestAnimationFrame(() => focusInputAtEnd(inputRef.current));
		},
		[
			value,
			isOwnedHandleState,
			isEditedAwayFromOwned,
			isFormatValid,
			isLocallyReserved,
			currentVerdict,
			isChecking,
			queryClient,
			router,
		],
	);

	// ── Dynamic status region content ─────────────────────────────────────────

	// Returns { text, showRetry, showReset } for the dynamic region.
	// This is the single source of truth for the status region.
	const dynamicStatus = (() => {
		// Owned-handle states take priority.
		if (isOwnedHandleState) {
			return {
				text: "Using your current handle.",
				showRetry: false,
				showReset: false,
			};
		}
		if (isEditedAwayFromOwned && claimHandleSeed.kind === "owned") {
			return {
				text: `Your handle is already @${claimHandleSeed.handle}.`,
				showRetry: false,
				showReset: true,
			};
		}

		// Empty — neutral (no error copy for ordinary empty editing).
		if (value === "") {
			return { text: "", showRetry: false, showReset: false };
		}

		// Format errors.
		if (!isFormatValid && formatReason) {
			return {
				text: reasonCopy(formatReason),
				showRetry: false,
				showReset: false,
			};
		}

		// Locally reserved.
		if (isLocallyReserved) {
			return {
				text: reasonCopy("reserved"),
				showRetry: false,
				showReset: false,
			};
		}

		// Debounce gap — neutral while waiting for check.
		if (isInDebouncedGap) {
			return { text: "", showRetry: false, showReset: false };
		}

		// Checking.
		if (isChecking) {
			return {
				text: "Checking availability…",
				showRetry: false,
				showReset: false,
			};
		}

		// Submit-time unavailable (already captured into currentVerdict).
		if (currentVerdict?.status === "unavailable") {
			return {
				text: reasonCopy(currentVerdict.reason),
				showRetry: false,
				showReset: false,
			};
		}

		// Available.
		if (currentVerdict?.status === "available") {
			return { text: "Available.", showRetry: false, showReset: false };
		}

		// Error.
		if (currentVerdict?.status === "error") {
			return {
				text: "Couldn’t check that handle — try again.",
				showRetry: true,
				showReset: false,
			};
		}

		return { text: "", showRetry: false, showReset: false };
	})();

	// ── Live preview ──────────────────────────────────────────────────────────

	// Show only for actionable values: owned-equal or availability-confirmed available.
	const showPreview =
		isOwnedHandleState || currentVerdict?.status === "available";

	const publicAppOrigin = getPublicAppOrigin();
	const previewHandle = isOwnedHandleState
		? claimHandleSeed.kind === "owned"
			? claimHandleSeed.handle
			: value
		: (normalizedHandle ?? value);
	const previewUrl = `${publicAppOrigin}/@${previewHandle}`;

	// ── Render ────────────────────────────────────────────────────────────────

	return (
		<div className="text-center">
			<h2
				className="theme-text text-4xl leading-tight font-extralight"
				style={{ fontFamily: fonts.display }}
			>
				Claim your <em className="font-normal">@handle</em>
			</h2>

			<form
				onSubmit={handleSubmit}
				noValidate
				className="mt-12 mx-auto max-w-sm text-left"
			>
				{/* Label */}
				<label
					htmlFor="claim-handle-input"
					className="theme-text-muted block text-xs tracking-widest uppercase mb-2"
					style={{ fontFamily: fonts.body }}
				>
					Handle
				</label>

				{/* Input */}
				<input
					id="claim-handle-input"
					ref={inputRef}
					type="text"
					value={value}
					onChange={handleChange}
					readOnly={submitInFlight}
					// biome-ignore lint/a11y/noAutofocus: §8.3 mandates autoFocus on mount — dedicated single-field onboarding step; intentional expected.
					autoFocus
					autoCapitalize="none"
					autoCorrect="off"
					spellCheck={false}
					autoComplete="off"
					placeholder="fabio"
					aria-describedby="claim-handle-helper claim-handle-status"
					className={[
						"theme-text theme-bg theme-border-color w-full border-b py-2",
						"text-base bg-transparent outline-none",
						"focus-visible:border-[color:var(--t-primary)]",
						"transition-[border-color] duration-150 ease-out",
						submitInFlight ? "opacity-70" : "",
					]
						.filter(Boolean)
						.join(" ")}
					style={{ fontFamily: fonts.body }}
				/>

				{/* Static helper — always visible, not a live region */}
				<p
					id="claim-handle-helper"
					className="theme-text-muted mt-3 text-xs leading-relaxed"
					style={{ fontFamily: fonts.body }}
				>
					Enter just the name — we’ll add the @ in your public URL. Use letters,
					numbers, periods, or underscores. Periods can’t start, end, or appear
					twice in a row.
				</p>

				{/* Dynamic status region — the single source of truth for feedback */}
				<div
					id="claim-handle-status"
					aria-live="polite"
					className="mt-2 min-h-[1.5rem] text-xs"
					style={{ fontFamily: fonts.body }}
				>
					{dynamicStatus.text && (
						<span
							className={
								dynamicStatus.showRetry || dynamicStatus.showReset
									? "theme-text-muted"
									: currentVerdict?.status === "available" || isOwnedHandleState
										? "theme-text-muted"
										: "theme-primary"
							}
						>
							{dynamicStatus.text}
						</span>
					)}

					{/* Reset action for owned-edited-away */}
					{dynamicStatus.showReset && claimHandleSeed.kind === "owned" && (
						<>
							{" "}
							<button
								type="button"
								onClick={handleReset}
								className="theme-primary underline cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 [outline-color:var(--t-primary)]"
								style={{ fontFamily: fonts.body }}
							>
								Use @{claimHandleSeed.handle}
							</button>
						</>
					)}

					{/* Retry action for availability error */}
					{dynamicStatus.showRetry && (
						<>
							{" "}
							<button
								type="button"
								onClick={handleRetry}
								className="theme-primary underline cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 [outline-color:var(--t-primary)]"
								style={{ fontFamily: fonts.body }}
							>
								Check again
							</button>
						</>
					)}
				</div>

				{/* Live preview — display-only, no anchor or interaction */}
				{showPreview && (
					<div className="mt-4" aria-hidden="true">
						<p
							className="theme-text-muted text-xs tracking-widest uppercase"
							style={{ fontFamily: fonts.body }}
						>
							Public URL
						</p>
						<p
							className="theme-text-muted mt-1 text-xs"
							style={{ fontFamily: fonts.body }}
						>
							{previewUrl}
						</p>
					</div>
				)}

				{/* Submit button */}
				<div className="mt-8 flex justify-center">
					<Button
						type="submit"
						variant="link"
						disabled={!canContinue}
						style={{ fontFamily: fonts.body }}
					>
						<span className="text-lg font-medium tracking-wide">
							{isSubmitting ? "Saving..." : "Continue"}
						</span>
						<ArrowRightIcon
							size={16}
							className="theme-text-muted inline-block transition-transform group-hover:translate-x-1"
						/>
					</Button>
				</div>
			</form>
		</div>
	);
}
