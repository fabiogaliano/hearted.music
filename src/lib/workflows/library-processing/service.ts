import { Result } from "better-result";
import { getTargetPlaylists } from "@/lib/domains/library/playlists/queries";
import { resolveAccountLabel } from "@/lib/observability/account-label";
import { log } from "@/lib/observability/logger";
import {
	getOrCreateLibraryProcessingState,
	persistLibraryProcessingState,
} from "./queries";
import { reconcileLibraryProcessing } from "./reconciler";
import {
	createReadinessAccessor,
	describeTrigger,
	executeEffect,
	loadJobOutcomeMetadata,
} from "./scheduler";
import type {
	LibraryProcessingApplyError,
	LibraryProcessingApplyOutcome,
	LibraryProcessingChange,
	LibraryProcessingEffectResult,
	LibraryProcessingState,
} from "./types";

async function persistActiveRefs(
	state: LibraryProcessingState,
	baselineState: LibraryProcessingState,
): Promise<Result<LibraryProcessingState, LibraryProcessingApplyError>> {
	if (state === baselineState) {
		return Result.ok(state);
	}

	const persistResult = await persistLibraryProcessingState(state);
	if (Result.isError(persistResult)) {
		return Result.err({
			kind: "persist_active_refs",
			cause: persistResult.error,
		});
	}

	return Result.ok(persistResult.value);
}

export async function applyLibraryProcessingChange(
	change: LibraryProcessingChange,
): Promise<Result<LibraryProcessingApplyOutcome, LibraryProcessingApplyError>> {
	const stateResult = await getOrCreateLibraryProcessingState(change.accountId);
	if (Result.isError(stateResult)) {
		return Result.err({
			kind: "load_state",
			cause: stateResult.error,
		});
	}

	const requestMarker = new Date().toISOString();

	const [jobOutcomeMetadata, hasTargets] = await Promise.all([
		loadJobOutcomeMetadata(change),
		resolveHasTargetPlaylists(change.accountId),
	]);

	const { state: newState, effects } = reconcileLibraryProcessing({
		state: stateResult.value,
		change,
		requestMarker,
		hasTargetPlaylists: hasTargets,
		satisfiedMarker: jobOutcomeMetadata.satisfiedMarker,
	});

	const persistResult = await persistLibraryProcessingState(newState);
	if (Result.isError(persistResult)) {
		return Result.err({
			kind: "persist_state",
			cause: persistResult.error,
		});
	}

	const actor = await resolveAccountLabel(change.accountId);
	log.info("library-processing", {
		actor,
		by: describeTrigger(change.kind),
		change: change.kind,
		effects:
			effects.length > 0 ? effects.map((e) => e.kind).join(", ") : "none",
		accountId: change.accountId,
	});

	let currentState = persistResult.value;
	const effectResults: LibraryProcessingEffectResult[] = [];
	// One accessor per change — memoises the readiness probe so that effects
	// sharing this change pay at most one DB read between them.
	const readinessAccessor = createReadinessAccessor(change.accountId);

	for (const effect of effects) {
		const effectResult = await executeEffect(
			effect,
			currentState,
			change,
			jobOutcomeMetadata,
			readinessAccessor,
		);
		if (Result.isError(effectResult)) {
			const persistActiveRefsResult = await persistActiveRefs(
				currentState,
				persistResult.value,
			);
			if (Result.isError(persistActiveRefsResult)) {
				return persistActiveRefsResult;
			}

			return Result.err(effectResult.error);
		}
		currentState = effectResult.value.state;
		effectResults.push({
			kind: effect.kind,
			status: "ensured",
			jobId: effectResult.value.jobId,
		});
	}

	const finalPersist = await persistActiveRefs(
		currentState,
		persistResult.value,
	);
	if (Result.isError(finalPersist)) {
		return finalPersist;
	}

	return Result.ok({
		accountId: change.accountId,
		changeKind: change.kind,
		state: finalPersist.value,
		effects,
		effectResults,
	});
}

async function resolveHasTargetPlaylists(accountId: string): Promise<boolean> {
	const result = await getTargetPlaylists(accountId);
	return Result.isOk(result) && result.value.length > 0;
}
