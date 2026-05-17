import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { readBillingState } from "@/lib/domains/billing/queries";
import type { BillingState } from "@/lib/domains/billing/state";
import { getCount as getLikedSongCount } from "@/lib/domains/library/liked-songs/queries";
import {
	getPlaylistSongs,
	getTargetPlaylists,
} from "@/lib/domains/library/playlists/queries";
import {
	ensureEnrichmentJob,
	ensureMatchSnapshotRefreshJob,
} from "@/lib/platform/jobs/library-processing-queue";
import { EnrichmentChunkProgressSchema } from "@/lib/platform/jobs/progress/enrichment";
import { getJobById } from "@/lib/platform/jobs/repository";
import {
	batchSizeForSequence,
	makeInitialProgress,
} from "@/lib/workflows/enrichment-pipeline/progress";
import { bandToNumeric, resolveQueuePriority } from "./queue-priority";
import type {
	LibraryProcessingApplyCause,
	LibraryProcessingApplyError,
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

export interface JobOutcomeMetadata {
	satisfiedMarker: string | null;
	batchSequence: number | null;
}

function toUnexpectedApplyCause(
	error: unknown,
): Extract<LibraryProcessingApplyCause, { kind: "unexpected" }> {
	return {
		kind: "unexpected",
		message: error instanceof Error ? error.message : String(error),
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

export async function executeEffect(
	effect: LibraryProcessingEffect,
	state: LibraryProcessingState,
	change: LibraryProcessingChange,
	jobOutcomeMetadata: JobOutcomeMetadata,
): Promise<
	Result<
		{ state: LibraryProcessingState; jobId: string },
		LibraryProcessingApplyError
	>
> {
	try {
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
				return Result.err(toEffectEnsureFailedError(effect.kind, result.error));
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
			return Result.err(toEffectEnsureFailedError(effect.kind, result.error));
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
	} catch (error) {
		return Result.err(
			toEffectEnsureFailedError(effect.kind, toUnexpectedApplyCause(error)),
		);
	}
}
