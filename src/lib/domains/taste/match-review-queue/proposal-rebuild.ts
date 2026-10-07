import { Result } from "better-result";
import type { DbError } from "@/lib/shared/errors/database";
import { type DeckJob, enqueueDeckJob } from "./deck-jobs";
import type { MatchOrientation } from "./types";
import { resolveVisibilityConfigHash } from "./visibility-config-hash";

/**
 * Enqueues a full proposal build for one orientation. The visibility hash is
 * part of the idempotency key (M1): a build for the current filters must not
 * dedupe against an in-flight build of stale ones, or an active session stays
 * stuck on the old filters.
 */
export function enqueueBuildProposals(input: {
	accountId: string;
	orientation: MatchOrientation;
	snapshotId: string;
	visibilityConfigHash: string;
}): Promise<Result<DeckJob | null, DbError>> {
	const { accountId, orientation, snapshotId, visibilityConfigHash } = input;
	return enqueueDeckJob({
		accountId,
		orientation,
		kind: "build_proposals",
		idempotencyKey: `build:${accountId}:${orientation}:${snapshotId}:${visibilityConfigHash}`,
		payload: { snapshotId },
	});
}

export interface ProposalRebuildFailure {
	orientation: MatchOrientation;
	step: "resolve_visibility_config_hash" | "enqueue_build_proposals";
	error: DbError;
}

/**
 * Enqueues proposal builds for both orientations against `snapshotId`, each
 * keyed on that orientation's current visibility hash. A failure in one
 * orientation does not stop the other; failures are returned for the caller to
 * report in its own runtime's terms.
 */
export async function enqueueProposalRebuild(
	accountId: string,
	snapshotId: string,
): Promise<ProposalRebuildFailure[]> {
	const failures: ProposalRebuildFailure[] = [];
	for (const orientation of ["song", "playlist"] as const) {
		const hashResult = await resolveVisibilityConfigHash(
			accountId,
			orientation,
		);
		if (Result.isError(hashResult)) {
			failures.push({
				orientation,
				step: "resolve_visibility_config_hash",
				error: hashResult.error,
			});
			continue;
		}
		const enqueued = await enqueueBuildProposals({
			accountId,
			orientation,
			snapshotId,
			visibilityConfigHash: hashResult.value.hash,
		});
		if (Result.isError(enqueued)) {
			failures.push({
				orientation,
				step: "enqueue_build_proposals",
				error: enqueued.error,
			});
		}
	}
	return failures;
}
