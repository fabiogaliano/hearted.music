import { Result } from "better-result";
import { getTargetPlaylists } from "@/lib/domains/library/playlists/queries";
import { resolveAccountLabel } from "@/lib/observability/account-label";
import { log } from "@/lib/observability/logger";
import {
	getOrCreateLibraryProcessingState,
	persistLibraryProcessingState,
	swapActiveJobRef,
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
	LibraryProcessingEffect,
	LibraryProcessingEffectResult,
	LibraryProcessingState,
} from "./types";

// Each attempt reloads and reconciles again, so a miss only means another
// runtime wrote in between; a few attempts outlast any realistic contention.
const MAX_PERSIST_ATTEMPTS = 3;

/**
 * Effects only set active job refs, so only those are written, each as its own
 * compare-and-set from the persisted baseline: a settle that cleared a ref in
 * the meantime is never overwritten with stale columns.
 */
async function persistActiveRefs(
	state: LibraryProcessingState,
	baselineState: LibraryProcessingState,
): Promise<Result<LibraryProcessingState, LibraryProcessingApplyError>> {
	const swaps = [
		[
			"enrichment",
			baselineState.enrichment.activeJobId,
			state.enrichment.activeJobId,
		],
		[
			"match_snapshot_refresh",
			baselineState.matchSnapshotRefresh.activeJobId,
			state.matchSnapshotRefresh.activeJobId,
		],
	] as const;

	for (const [workflow, from, to] of swaps) {
		if (from === to) continue;
		const swapResult = await swapActiveJobRef(
			state.accountId,
			workflow,
			from,
			to,
		);
		if (Result.isError(swapResult)) {
			return Result.err({
				kind: "persist_active_refs",
				cause: swapResult.error,
			});
		}
	}

	return Result.ok(state);
}

export async function applyLibraryProcessingChange(
	change: LibraryProcessingChange,
): Promise<Result<LibraryProcessingApplyOutcome, LibraryProcessingApplyError>> {
	const requestMarker = new Date().toISOString();

	const [jobOutcomeMetadata, hasTargets] = await Promise.all([
		loadJobOutcomeMetadata(change),
		resolveHasTargetPlaylists(change.accountId),
	]);

	// Load → reconcile → compare-and-set write. Both the Cloudflare server fns
	// and the Bun worker apply changes, so the row can move between our read
	// and our write; a blind write would put stale active refs back.
	let persisted: LibraryProcessingState | null = null;
	let effects: LibraryProcessingEffect[] = [];
	for (
		let attempt = 0;
		attempt < MAX_PERSIST_ATTEMPTS && persisted === null;
		attempt++
	) {
		const stateResult = await getOrCreateLibraryProcessingState(
			change.accountId,
		);
		if (Result.isError(stateResult)) {
			return Result.err({ kind: "load_state", cause: stateResult.error });
		}

		const reconciled = reconcileLibraryProcessing({
			state: stateResult.value,
			change,
			requestMarker,
			hasTargetPlaylists: hasTargets,
			satisfiedMarker: jobOutcomeMetadata.satisfiedMarker,
		});

		const persistResult = await persistLibraryProcessingState(reconciled.state);
		if (Result.isError(persistResult)) {
			return Result.err({ kind: "persist_state", cause: persistResult.error });
		}
		persisted = persistResult.value;
		effects = reconciled.effects;
	}
	if (persisted === null) {
		return Result.err({ kind: "persist_conflict" });
	}
	const persistedState = persisted;

	const actor = await resolveAccountLabel(change.accountId);
	log.info("library-processing", {
		actor,
		by: describeTrigger(change.kind),
		change: change.kind,
		effects:
			effects.length > 0 ? effects.map((e) => e.kind).join(", ") : "none",
		accountId: change.accountId,
	});

	let currentState = persistedState;
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
				persistedState,
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

	const finalPersist = await persistActiveRefs(currentState, persistedState);
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
