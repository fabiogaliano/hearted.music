// A job is superseded when a newer refresh request has arrived after the job
// was scheduled to satisfy the current one. Jobs with null satisfies_requested_at
// are legacy jobs; skip cooperative cancellation rather than guessing staleness.
export function isMatchRefreshJobSuperseded(
	job: { satisfies_requested_at: string | null },
	latestRequestedAt: string | null,
): boolean {
	if (job.satisfies_requested_at === null) return false;
	if (latestRequestedAt === null) return false;
	return latestRequestedAt > job.satisfies_requested_at;
}
