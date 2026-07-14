import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { readBillingStateOrFreeTier } from "@/lib/domains/billing/queries";
import { getCount as getLikedSongCount } from "@/lib/domains/library/liked-songs/queries";
import {
	getPlaylistSongs,
	getTargetPlaylists,
} from "@/lib/domains/library/playlists/queries";
import {
	hasFirstVisibleReviewSubject,
	resolveReadinessPermissive,
} from "@/lib/domains/taste/match-review-queue/readiness";
import { resolveAccountLabel } from "@/lib/observability/account-label";
import { log } from "@/lib/observability/logger";
import {
	ensureEnrichmentJob,
	ensureMatchSnapshotRefreshJob,
} from "@/lib/platform/jobs/library-processing-queue";
import {
	EnrichmentChunkProgressSchema,
	type EnrichmentSelectionMode,
} from "@/lib/platform/jobs/progress/enrichment";
import { getJobById } from "@/lib/platform/jobs/repository";
import { errorMessage } from "@/lib/shared/errors/error-message";
import {
	batchSizeForSequence,
	makeInitialProgress,
} from "@/lib/workflows/enrichment-pipeline/progress";
import { resolveEnrichmentBand, resolveRefreshBand } from "./band-policy";
import { resolveMatchRefreshAvailableAt } from "./match-refresh-debounce";
import { bandToNumeric } from "./queue-priority";
import type {
	LibraryProcessingApplyCause,
	LibraryProcessingApplyError,
	LibraryProcessingChange,
	LibraryProcessingEffect,
	LibraryProcessingState,
} from "./types";

export interface JobOutcomeMetadata {
	satisfiedMarker: string | null;
	batchSequence: number | null;
}

/** Plain-language reason a job is being queued, for the trigger banner. */
export function describeTrigger(
	changeKind: LibraryProcessingChange["kind"],
): string {
	switch (changeKind) {
		case "onboarding_target_selection_confirmed":
			return "starter playlists picked";
		case "first_match_setup_completed":
			return "first matching setup completed";
		case "library_synced":
			return "Spotify library synced";
		case "enrichment_completed":
			return "songs finished enriching";
		case "playlist_management_session_flushed":
			return "matching playlists changed";
		case "enrichment_work_available":
			return "maintenance recovery";
		case "songs_unlocked":
			return "songs unlocked";
		case "unlimited_activated":
			return "unlimited activated";
		case "candidate_access_revoked":
			return "access revoked";
		case "match_snapshot_published":
			return "previous match published";
		default:
			return changeKind;
	}
}

function toUnexpectedApplyCause(
	error: unknown,
): Extract<LibraryProcessingApplyCause, { kind: "unexpected" }> {
	return {
		kind: "unexpected",
		message: errorMessage(error),
	};
}

function toEffectEnsureFailedError(
	effectKind: LibraryProcessingEffect["kind"],
	cause: LibraryProcessingApplyCause,
): Extract<LibraryProcessingApplyError, { kind: "effect_ensure_failed" }> {
	return {
		kind: "effect_ensure_failed",
		effectKind,
		cause,
	};
}

export async function loadJobOutcomeMetadata(
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

function changeMayNeedTargetSongEnrichment(
	change: LibraryProcessingChange,
): boolean {
	switch (change.kind) {
		case "onboarding_target_selection_confirmed":
			return true;
		case "first_match_setup_completed":
			// First target playlist was just saved — its songs may need enrichment
			// before they become match candidates.
			return true;
		case "library_synced":
			return change.changes.targetPlaylists.trackMembershipChanged;
		default:
			return false;
	}
}

export async function deriveNeedsTargetSongEnrichment(
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

/**
 * Creates a memoized readiness accessor for a single change's effects.
 *
 * Probes `hasFirstVisibleReviewSubject` at most once regardless of how many
 * effects share it — the Promise is cached on first call and reused thereafter.
 * Callers that never invoke the accessor pay zero DB reads.
 */
export function createReadinessAccessor(
	accountId: string,
): () => Promise<boolean> {
	let cachedPromise: Promise<boolean> | null = null;
	return () => {
		if (cachedPromise === null) {
			cachedPromise = hasFirstVisibleReviewSubject(accountId).then(
				resolveReadinessPermissive,
			);
		}
		return cachedPromise;
	};
}

export async function executeEffect(
	effect: LibraryProcessingEffect,
	state: LibraryProcessingState,
	change: LibraryProcessingChange,
	jobOutcomeMetadata: JobOutcomeMetadata,
	readinessAccessor: () => Promise<boolean>,
): Promise<
	Result<
		{ state: LibraryProcessingState; jobId: string },
		LibraryProcessingApplyError
	>
> {
	try {
		const supabase = createAdminSupabaseClient();
		const billingState = await readBillingStateOrFreeTier(
			supabase,
			effect.accountId,
			"library_processing_execute_effect",
		);
		const billingBand = billingState.queueBand;
		const band = resolveEnrichmentBand(billingBand, change.kind);
		const queuePriority = bandToNumeric(band);
		const actor = await resolveAccountLabel(effect.accountId);

		// Delegate to the per-change memoized accessor — probes at most once across
		// all effects for this change. Permissive degradation (error → true) is
		// baked in at accessor creation time via resolveReadinessPermissive.
		const firstVisibleReady = await readinessAccessor();

		if (effect.kind === "ensure_enrichment_job") {
			const countResult = await getLikedSongCount(effect.accountId);
			const total = Result.isOk(countResult) ? countResult.value : 0;

			const previousBatchSequence = jobOutcomeMetadata.batchSequence ?? 0;
			const nextSequence =
				change.kind === "enrichment_completed" ? previousBatchSequence + 1 : 0;
			const nextBatchSize = batchSizeForSequence(nextSequence);

			const selectionMode: EnrichmentSelectionMode = firstVisibleReady
				? "normal"
				: "first_match_bootstrap";

			const progress = makeInitialProgress(
				nextBatchSize,
				nextSequence,
				total,
				selectionMode,
			);

			const result = await ensureEnrichmentJob({
				accountId: effect.accountId,
				satisfiesRequestedAt: effect.satisfiesRequestedAt,
				queuePriority,
				progress,
			});
			if (Result.isError(result)) {
				return Result.err(toEffectEnsureFailedError(effect.kind, result.error));
			}
			log.info("▶ ENRICH QUEUED", {
				actor,
				by: describeTrigger(change.kind),
				batch: nextSequence,
				songs: total,
				priority: band,
				selectionMode,
				jobId: result.value.id,
			});
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

		const isFirstVisibleBootstrap = !firstVisibleReady;
		const refreshBand = resolveRefreshBand(billingBand, {
			isFirstVisibleBootstrap,
		});
		const refreshQueuePriority = bandToNumeric(refreshBand);

		const availableAt = resolveMatchRefreshAvailableAt({
			changeKind: change.kind,
			now: new Date(),
		});

		const result = await ensureMatchSnapshotRefreshJob({
			accountId: effect.accountId,
			satisfiesRequestedAt: effect.satisfiesRequestedAt,
			queuePriority: refreshQueuePriority,
			needsTargetSongEnrichment,
			availableAt,
		});
		if (Result.isError(result)) {
			return Result.err(toEffectEnsureFailedError(effect.kind, result.error));
		}
		log.info("▶ MATCH QUEUED", {
			actor,
			by: describeTrigger(change.kind),
			needsTargetEnrichment: needsTargetSongEnrichment,
			priority: refreshBand,
			firstVisibleBootstrap: isFirstVisibleBootstrap,
			jobId: result.value.id,
		});
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
	} catch (error) {
		return Result.err(
			toEffectEnsureFailedError(effect.kind, toUnexpectedApplyCause(error)),
		);
	}
}
