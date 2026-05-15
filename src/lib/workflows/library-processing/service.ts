import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import {
	ensureEnrichmentJob,
	ensureMatchSnapshotRefreshJob,
	getJobById,
} from "@/lib/data/jobs";
import { readBillingState } from "@/lib/domains/billing/queries";
import type { BillingState } from "@/lib/domains/billing/state";
import { getCount as getLikedSongCount } from "@/lib/domains/library/liked-songs/queries";
import {
	getPlaylistSongs,
	getTargetPlaylists,
} from "@/lib/domains/library/playlists/queries";
import { EnrichmentChunkProgressSchema } from "@/lib/platform/jobs/progress/enrichment";
import {
	batchSizeForSequence,
	makeInitialProgress,
} from "@/lib/workflows/enrichment-pipeline/progress";
import {
	getOrCreateLibraryProcessingState,
	persistLibraryProcessingState,
} from "./queries";
import { bandToNumeric, resolveQueuePriority } from "./queue-priority";
import { reconcileLibraryProcessing } from "./reconciler";
import type {
	LibraryProcessingApplyCause,
	LibraryProcessingApplyError,
	LibraryProcessingApplyOutcome,
	LibraryProcessingEffectResult,
	LibraryProcessingChange,
	LibraryProcessingEffect,
	LibraryProcessingState,
} from "./types";

const FREE_DEFAULT_BILLING_STATE: BillingState = {
	plan: "free",
	creditBalance: 0,
	subscriptionStatus: "none",
	cancelAtPeriodEnd: false,
	subscriptionPeriodEnd: null,
	unlimitedAccess: { kind: "none" },
	queueBand: "low",
};

interface JobOutcomeMetadata {
	satisfiedMarker: string | null;
	batchSequence: number | null;
}

function changeMayNeedTargetSongEnrichment(
	change: LibraryProcessingChange,
): boolean {
	switch (change.kind) {
		case "onboarding_target_selection_confirmed":
			return true;
		case "library_synced":
			return change.changes.targetPlaylists.trackMembershipChanged;
		default:
			return false;
	}
}

async function loadJobOutcomeMetadata(
	change: LibraryProcessingChange,
): Promise<JobOutcomeMetadata> {
	if (
		change.kind !== "enrichment_completed" &&
		change.kind !== "match_snapshot_published"
	) {
		return { satisfiedMarker: null, batchSequence: null };
	}

	const jobResult = await getJobById(change.jobId);
	if (Result.isError(jobResult) || jobResult.value === null) {
		return { satisfiedMarker: null, batchSequence: null };
	}

	if (change.kind === "match_snapshot_published") {
		return {
			satisfiedMarker: jobResult.value.satisfies_requested_at,
			batchSequence: null,
		};
	}

	const progressResult = EnrichmentChunkProgressSchema.partial().safeParse(
		jobResult.value.progress ?? {},
	);

	return {
		satisfiedMarker: jobResult.value.satisfies_requested_at,
		batchSequence: progressResult.success
			? (progressResult.data.batchSequence ?? null)
			: null,
	};
}

async function deriveNeedsTargetSongEnrichment(
	accountId: string,
	change: LibraryProcessingChange,
): Promise<boolean> {
	if (!changeMayNeedTargetSongEnrichment(change)) {
		return false;
	}

	const targetPlaylistsResult = await getTargetPlaylists(accountId);
	if (
		Result.isError(targetPlaylistsResult) ||
		targetPlaylistsResult.value.length === 0
	) {
		return false;
	}

	const playlistSongResults = await Promise.all(
		targetPlaylistsResult.value.map((playlist) =>
			getPlaylistSongs(playlist.id),
		),
	);

	const targetSongIds = new Set<string>();
	for (const playlistSongResult of playlistSongResults) {
		if (Result.isError(playlistSongResult)) {
			continue;
		}

		for (const playlistSong of playlistSongResult.value) {
			targetSongIds.add(playlistSong.song_id);
		}
	}

	if (targetSongIds.size === 0) {
		return false;
	}

	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase
		.from("liked_song")
		.select("song_id")
		.eq("account_id", accountId)
		.is("unliked_at", null)
		.in("song_id", [...targetSongIds]);

	if (error) {
		return false;
	}

	const likedSongIds = new Set((data ?? []).map((row) => row.song_id));
	for (const targetSongId of targetSongIds) {
		if (!likedSongIds.has(targetSongId)) {
			return true;
		}
	}

	return false;
}

function toUnexpectedApplyCause(
	error: unknown,
): Extract<LibraryProcessingApplyCause, { kind: "unexpected" }> {
	return {
		kind: "unexpected",
		message: error instanceof Error ? error.message : String(error),
	};
}

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

async function executeEffect(
	effect: LibraryProcessingEffect,
	state: LibraryProcessingState,
	change: LibraryProcessingChange,
	jobOutcomeMetadata: JobOutcomeMetadata,
): Promise<
	Result<
		{ state: LibraryProcessingState; jobId: string },
		LibraryProcessingApplyCause
	>
> {
	const supabase = createAdminSupabaseClient();
	const billingResult = await readBillingState(supabase, effect.accountId);
	const billingBand = resolveQueuePriority(
		Result.isOk(billingResult)
			? billingResult.value
			: FREE_DEFAULT_BILLING_STATE,
	);
	const band =
		change.kind === "onboarding_target_selection_confirmed"
			? "priority"
			: billingBand;
	const queuePriority = bandToNumeric(band);

	if (effect.kind === "ensure_enrichment_job") {
		const countResult = await getLikedSongCount(effect.accountId);
		const total = Result.isOk(countResult) ? countResult.value : 0;

		// Carry batch progression across re-ensured jobs (1 → 5 → 10 → 25 → 50)
		const previousBatchSequence = jobOutcomeMetadata.batchSequence ?? 0;
		const nextSequence =
			change.kind === "enrichment_completed" ? previousBatchSequence + 1 : 0;
		const nextBatchSize = batchSizeForSequence(nextSequence);
		const progress = makeInitialProgress(nextBatchSize, nextSequence, total);

		const result = await ensureEnrichmentJob({
			accountId: effect.accountId,
			satisfiesRequestedAt: effect.satisfiesRequestedAt,
			queuePriority,
			progress,
		});
		if (Result.isError(result)) {
			return Result.err(result.error);
		}
		return Result.ok({
			state: {
				...state,
				enrichment: {
					...state.enrichment,
					activeJobId: result.value.id,
				},
			},
			jobId: result.value.id,
		});
	}

	const needsTargetSongEnrichment = await deriveNeedsTargetSongEnrichment(
		effect.accountId,
		change,
	);

	const result = await ensureMatchSnapshotRefreshJob({
		accountId: effect.accountId,
		satisfiesRequestedAt: effect.satisfiesRequestedAt,
		queuePriority,
		needsTargetSongEnrichment,
	});
	if (Result.isError(result)) {
		return Result.err(result.error);
	}
	return Result.ok({
		state: {
			...state,
			matchSnapshotRefresh: {
				...state.matchSnapshotRefresh,
				activeJobId: result.value.id,
			},
		},
		jobId: result.value.id,
	});
}

/**
 * The single public entrypoint for all library-processing changes.
 *
 * 1. Loads or creates LibraryProcessingState
 * 2. Stamps a request marker for this apply cycle
 * 3. Reconciles the change against current state
 * 4. Persists the updated state
 * 5. Executes ensure-job effects and persists activeJobId refs
 */
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

	console.log(
		`[library-processing] change=${change.kind} effects=[${effects.map((e) => e.kind).join(", ")}]`,
	);

	let currentState = persistResult.value;
	const effectResults: LibraryProcessingEffectResult[] = [];

	for (const effect of effects) {
		try {
			const effectResult = await executeEffect(
				effect,
				currentState,
				change,
				jobOutcomeMetadata,
			);
			if (Result.isError(effectResult)) {
				const persistActiveRefsResult = await persistActiveRefs(
					currentState,
					persistResult.value,
				);
				if (Result.isError(persistActiveRefsResult)) {
					return persistActiveRefsResult;
				}

				return Result.err({
					kind: "effect_ensure_failed",
					effectKind: effect.kind,
					cause: effectResult.error,
				});
			}
			currentState = effectResult.value.state;
			effectResults.push({
				kind: effect.kind,
				status: "ensured",
				jobId: effectResult.value.jobId,
			});
		} catch (err) {
			const persistActiveRefsResult = await persistActiveRefs(
				currentState,
				persistResult.value,
			);
			if (Result.isError(persistActiveRefsResult)) {
				return persistActiveRefsResult;
			}

			return Result.err({
				kind: "effect_ensure_failed",
				effectKind: effect.kind,
				cause: toUnexpectedApplyCause(err),
			});
		}
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
