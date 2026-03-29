import type { Enums } from "@/lib/data/database.types";
import {
	createPendingEnrichmentStages,
	type EnrichmentChunkProgress,
	EnrichmentChunkProgressSchema,
} from "./enrichment";
import {
	createPendingMatchRefreshStages,
	MATCH_REFRESH_STAGE_NAMES,
	type MatchSnapshotRefreshProgress,
	MatchSnapshotRefreshProgressSchema,
} from "./match-snapshot-refresh";

export type ParsedJobProgress =
	| {
			type: "enrichment";
			progress: EnrichmentChunkProgress;
	  }
	| {
			type: "match_snapshot_refresh";
			progress: MatchSnapshotRefreshProgress;
	  }
	| {
			type: "unknown";
			progress: null;
	  };

export function parseJobProgress(
	jobType: Enums<"job_type"> | string,
	raw: unknown,
): ParsedJobProgress {
	if (jobType === "enrichment") {
		const result = EnrichmentChunkProgressSchema.partial().safeParse(raw);
		if (result.success) {
			return {
				type: "enrichment",
				progress: fillEnrichmentDefaults(result.data),
			};
		}
	}

	if (jobType === "match_snapshot_refresh") {
		const result = MatchSnapshotRefreshProgressSchema.partial().safeParse(raw);
		if (result.success) {
			return {
				type: "match_snapshot_refresh",
				progress: fillMatchSnapshotRefreshDefaults(result.data),
			};
		}
	}

	return { type: "unknown", progress: null };
}

function fillEnrichmentDefaults(
	partial: Partial<EnrichmentChunkProgress>,
): EnrichmentChunkProgress {
	return {
		total: partial.total ?? 0,
		done: partial.done ?? 0,
		succeeded: partial.succeeded ?? 0,
		failed: partial.failed ?? 0,
		currentStage: partial.currentStage,
		stages: {
			...createPendingEnrichmentStages(),
			...(partial.stages ?? {}),
		},
		batchSize: partial.batchSize ?? 0,
		batchSequence: partial.batchSequence ?? 0,
	};
}

function fillMatchSnapshotRefreshDefaults(
	partial: Partial<MatchSnapshotRefreshProgress>,
): MatchSnapshotRefreshProgress {
	return {
		total: partial.total ?? MATCH_REFRESH_STAGE_NAMES.length,
		done: partial.done ?? 0,
		succeeded: partial.succeeded ?? 0,
		failed: partial.failed ?? 0,
		currentStage: partial.currentStage,
		stages: {
			...createPendingMatchRefreshStages(),
			...(partial.stages ?? {}),
		},
		plan: partial.plan,
		playlistCount: partial.playlistCount,
		candidateCount: partial.candidateCount,
		matchedSongCount: partial.matchedSongCount,
		published: partial.published,
		noOp: partial.noOp,
		isEmpty: partial.isEmpty,
	};
}
