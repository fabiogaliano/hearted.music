/**
 * Composes the visibility-config hash trio: resolveMinMatchScore +
 * fetchTargetPlaylistFilters + computeVisibilityPolicyHash. This is the exact
 * sequence the request-path deck resolver needs to determine "what proposal
 * matches this account's current settings right now" — and the same sequence
 * the build-job idempotency key needs so a filter/strictness change mints a
 * distinct key (plan §5.3) instead of deduping against an in-flight build of
 * the old settings (M1).
 *
 * Two DB round trips (strictness preference + target-playlist filters) per
 * call. Callers that can avoid needing the hash at all — e.g.
 * start_or_resume_match_deck's branch 1 (active session), which never reads
 * p_visibility_config_hash — should skip calling this rather than call it
 * defensively (see resolveMatchDeckView's skipHashComputation mode, M10).
 */

import { Result } from "better-result";
import { resolveMinMatchScore } from "@/lib/domains/library/accounts/preferences-queries";
import type { DbError } from "@/lib/shared/errors/database";
import { fetchTargetPlaylistFilters } from "./queries";
import type { MatchOrientation } from "./types";
import {
	computeVisibilityPolicyHash,
	type VisibilityPolicy,
} from "./visibility-policy";

export interface VisibilityConfigHashResult {
	hash: string;
	minScore: number;
	policy: VisibilityPolicy;
}

/**
 * Resolves the current visibility-config hash for an account+orientation.
 * `nowMs` is threaded into the hash (folds in the resolved UTC date for a
 * "today"-bounded filter, Finding 3) — pass the same nowMs a caller derives
 * subjects/builds with so the hash and the visible set agree.
 */
export async function resolveVisibilityConfigHash(
	accountId: string,
	orientation: MatchOrientation,
	nowMs: number = Date.now(),
): Promise<Result<VisibilityConfigHashResult, DbError>> {
	const minScore = await resolveMinMatchScore(accountId);

	const filtersResult = await fetchTargetPlaylistFilters(accountId);
	if (Result.isError(filtersResult)) return filtersResult;

	const policy: VisibilityPolicy = {
		orientation,
		minScore,
		filtersByPlaylistId: filtersResult.value,
	};

	return Result.ok({
		hash: computeVisibilityPolicyHash(policy, nowMs),
		minScore,
		policy,
	});
}
