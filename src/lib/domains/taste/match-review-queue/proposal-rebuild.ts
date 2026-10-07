import { Result } from "better-result";
import type { DbError } from "@/lib/shared/errors/database";
import { type DeckJob, enqueueDeckJob } from "./deck-jobs";
import { hasReadyProposal } from "./queries";
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
	step:
		| "resolve_visibility_config_hash"
		| "find_ready_proposal"
		| "enqueue_build_proposals";
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

/**
 * Enqueues proposal builds for `snapshotId` only for the orientations with no
 * ready proposal under their current visibility hash. A no-op
 * refresh needs this: its publish names no snapshot, so a run that published
 * and then died before enqueueing re-runs as a no-op and would otherwise leave
 * the build owed until a user hits the deck's miss path. Unlike
 * enqueueProposalRebuild it never rebuilds a proposal that already exists.
 * A "today"-bounded filter folds the UTC date into the hash, so the first
 * no-op after midnight finds no ready proposal and rebuilds that orientation.
 */
export async function enqueueMissingProposalBuilds(
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
		const key = {
			accountId,
			orientation,
			snapshotId,
			visibilityConfigHash: hashResult.value.hash,
		};
		const ready = await hasReadyProposal(key);
		if (Result.isError(ready)) {
			failures.push({
				orientation,
				step: "find_ready_proposal",
				error: ready.error,
			});
			continue;
		}
		if (ready.value) continue;
		const enqueued = await enqueueBuildProposals(key);
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
