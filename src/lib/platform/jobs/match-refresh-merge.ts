import {
	createInitialMatchSnapshotRefreshProgress,
	type MatchSnapshotRefreshProgress,
	MatchSnapshotRefreshProgressSchema,
} from "@/lib/platform/jobs/progress/match-snapshot-refresh";

// Picks the later of two ISO timestamps, treating null as the earliest
// possible value so any real timestamp supersedes it.
export function latestRequestedAt(
	existing: string | null,
	incoming: string,
): string {
	if (existing === null) return incoming;
	return existing >= incoming ? existing : incoming;
}

// Merges an incoming needsTargetSongEnrichment flag into an existing pending
// job's progress. The flag is ORed so once any coalesced trigger requires
// enrichment, the merged job preserves that requirement. Stage state in the
// progress is preserved; only the plan field is updated.
export function mergeMatchRefreshProgress(
	existingProgressJson: unknown,
	incomingNeedsEnrichment: boolean,
): MatchSnapshotRefreshProgress {
	const parsed = MatchSnapshotRefreshProgressSchema.safeParse(
		existingProgressJson ?? {},
	);

	const existingNeedsEnrichment = parsed.success
		? (parsed.data.plan?.needsTargetSongEnrichment ?? false)
		: false;
	const mergedNeedsEnrichment =
		existingNeedsEnrichment || incomingNeedsEnrichment;

	if (parsed.success) {
		return {
			...parsed.data,
			plan: { needsTargetSongEnrichment: mergedNeedsEnrichment },
		};
	}

	return createInitialMatchSnapshotRefreshProgress({
		needsTargetSongEnrichment: mergedNeedsEnrichment,
	});
}
