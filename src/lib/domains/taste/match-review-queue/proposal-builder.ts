/**
 * Write-time proposal builder (plan §6). For one (account, orientation,
 * snapshot) it builds a proposal per strictness preset: ordered review subjects
 * (deriveProposalSubjects — the SAME pure derivation the request-path append
 * uses, so subject order agrees by construction) plus a window-bounded promotion
 * seed for the first few subjects (computeVisibleSuggestionList — the SAME
 * derivation capture uses). A proposal never creates sessions, queue items, or
 * visible-pair rows.
 *
 * Idempotent by construction: the proposal upserts on its unique key, subjects
 * are deleted-then-reinserted (cascading the seed rows), and the seed capture is
 * a pure copy — so a sweep-resurrected double-run converges to the same rows.
 * `repair` reuses this function.
 *
 * The seed derivation reuses the existing generated-type RPCs.
 */

import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { getLatestMatchSnapshot } from "@/lib/domains/taste/song-matching/queries";
import {
	MATCH_STRICTNESS_VALUES,
	STRICTNESS_MIN_SCORE,
} from "@/lib/domains/taste/song-matching/strictness";
import type { DbError } from "@/lib/shared/errors/database";
import { DatabaseError } from "@/lib/shared/errors/database";
import {
	PLAYLIST_CARD_SUGGESTION_CAP,
	SONG_CARD_SUGGESTION_CAP,
} from "./card-suggestion-caps";
import { deriveProposalSubjects } from "./eligible-subjects";
import type {
	MatchOrientation,
	MatchReviewQueueItemDto,
	MatchReviewSubject,
	OrderedSubject,
} from "./types";
import {
	computeReadTimeFiltersHash,
	computeVisibilityPolicyHash,
	type VisibilityPolicy,
} from "./visibility-policy";
import {
	computeVisibleSuggestionList,
	type VisibleSuggestion,
} from "./visible-suggestion-list";

/**
 * How many leading subjects get a promotion seed. Kept small (the seed exists
 * only so promotion's first-window capture is pure SQL); cards past the window
 * are captured by the capture_ahead job.
 */
export const PROMOTION_SEED_SUBJECTS = 3;

interface ProposalSubjectInsert {
	proposal_id: string;
	position: number;
	orientation: MatchOrientation;
	song_id: string | null;
	playlist_id: string | null;
	source_fit_score: number;
	was_new_at_enqueue: boolean;
}

interface ProposalSeedPairInsert {
	proposal_id: string;
	subject_position: number;
	song_id: string;
	playlist_id: string;
	fit_score: number;
	model_rank: number;
	visible_rank: number;
}

/**
 * Pure: maps ordered subjects to proposal_subject rows, position = index. The
 * position order IS the subject order — the parity guarantee the read path
 * depends on.
 */
export function orderedSubjectsToProposalSubjectRows(
	subjects: readonly OrderedSubject[],
	proposalId: string,
): ProposalSubjectInsert[] {
	return subjects.map((s, index) => ({
		proposal_id: proposalId,
		position: index,
		orientation: s.subject.orientation,
		song_id: s.subject.orientation === "song" ? s.subject.songId : null,
		playlist_id:
			s.subject.orientation === "playlist" ? s.subject.playlistId : null,
		source_fit_score: s.maxScore,
		was_new_at_enqueue: s.wasNewAtEnqueue,
	}));
}

/**
 * Pure: maps a subject's visible suggestions to seed_pair rows field-for-field.
 * The output mirrors what promotion copies into match_review_item_visible_pair.
 */
export function visibleSuggestionsToSeedPairRows(
	suggestions: readonly VisibleSuggestion[],
	proposalId: string,
	subjectPosition: number,
): ProposalSeedPairInsert[] {
	return suggestions.map((sug) => ({
		proposal_id: proposalId,
		subject_position: subjectPosition,
		song_id: sug.songId,
		playlist_id: sug.playlistId,
		fit_score: sug.fitScore,
		model_rank: sug.modelRank,
		visible_rank: sug.visibleRank,
	}));
}

/**
 * A sessionless stand-in for computeVisibleSuggestionList, which reads only the
 * subject, account, and source snapshot from the item. The other fields are
 * unread placeholders.
 */
function syntheticProposalItem(
	subject: MatchReviewSubject,
	accountId: string,
	snapshotId: string,
	position: number,
): MatchReviewQueueItemDto {
	return {
		id: "",
		sessionId: "",
		accountId,
		subject,
		sourceSnapshotId: snapshotId,
		position,
		state: "pending",
		resolution: null,
		sourceScore: 0,
		wasNewAtEnqueue: false,
		presentedAt: null,
		resolvedAt: null,
		visiblePairsCapturedAt: null,
		createdAt: "",
		updatedAt: "",
	};
}

function dbErr(error: { code?: string; message: string }): DbError {
	return new DatabaseError({
		code: error.code ?? "proposal_build_error",
		message: error.message,
	});
}

/**
 * Builds (or rebuilds) the promotion seed for one subject: derives the visible
 * suggestion list, caps it per orientation, and returns the seed rows. A subject
 * whose entity was revoked/deleted since build returns [] (no seed — it surfaces
 * as unavailable at promotion); a DB failure surfaces as an error so the job
 * defers rather than shipping a partial seed.
 */
async function buildSeedForSubject(
	subject: MatchReviewSubject,
	accountId: string,
	snapshotId: string,
	minScore: number,
	proposalId: string,
	subjectPosition: number,
): Promise<Result<ProposalSeedPairInsert[], DbError>> {
	const item = syntheticProposalItem(
		subject,
		accountId,
		snapshotId,
		subjectPosition,
	);
	const listResult = await computeVisibleSuggestionList(item, minScore);
	if (listResult.kind === "db-error") {
		return Result.err(listResult.error);
	}
	if (listResult.kind === "not-entitled") {
		return Result.ok([]);
	}
	const cap =
		subject.orientation === "song"
			? SONG_CARD_SUGGESTION_CAP
			: PLAYLIST_CARD_SUGGESTION_CAP;
	const capped = listResult.list.suggestions.slice(0, cap);
	return Result.ok(
		visibleSuggestionsToSeedPairRows(capped, proposalId, subjectPosition),
	);
}

/**
 * Builds one proposal for a single (account, orientation, snapshot, preset).
 * Exported for the Phase 3 request-path miss handler (match-deck-miss-path.ts),
 * which builds ONLY the current preset synchronously so a re-invoked
 * start_or_resume_match_deck hits a ready proposal for the exact same
 * visibility_config_hash (the hash is derived here from the SAME filters + nowMs
 * the caller passes to the RPC, so byte-identical keys are guaranteed). Behavior
 * is unchanged from the private version.
 */
export async function buildOneProposal(
	accountId: string,
	orientation: MatchOrientation,
	snapshotId: string,
	preset: string,
	minScore: number,
	nowMs: number,
): Promise<Result<void, DbError>> {
	const derivationResult = await deriveProposalSubjects(
		accountId,
		orientation,
		snapshotId,
		minScore,
		nowMs,
	);
	if (Result.isError(derivationResult)) return derivationResult;
	const { subjects, hiddenReviewItemCount, filtersByPlaylistId } =
		derivationResult.value;

	// Hash from the exact filters the derivation read + the shared nowMs, so the
	// proposal key matches appendSnapshotDelta's under the same policy.
	const policy: VisibilityPolicy = {
		orientation,
		minScore,
		filtersByPlaylistId,
	};
	const visibilityConfigHash = computeVisibilityPolicyHash(policy, nowMs);
	const readTimeFiltersHash = computeReadTimeFiltersHash(
		filtersByPlaylistId,
		nowMs,
	);

	const db = createAdminSupabaseClient();
	const upsertResult = await db
		.from("match_review_proposal")
		.upsert(
			{
				account_id: accountId,
				orientation,
				snapshot_id: snapshotId,
				visibility_config_hash: visibilityConfigHash,
				strictness_preset: preset,
				strictness_min_score: minScore,
				read_time_filters_hash: readTimeFiltersHash,
				status: "building",
				total_subjects: 0,
				hidden_review_item_count: 0,
			},
			{
				onConflict: "account_id,orientation,snapshot_id,visibility_config_hash",
			},
		)
		.select("id")
		.single();
	if (upsertResult.error) return Result.err(dbErr(upsertResult.error));
	const proposalId = upsertResult.data.id;

	// Rebuild-safe: drop prior subjects (cascades to seed pairs) before reinsert.
	const deleteResult = await db
		.from("match_review_proposal_subject")
		.delete()
		.eq("proposal_id", proposalId);
	if (deleteResult.error) return Result.err(dbErr(deleteResult.error));

	if (subjects.length > 0) {
		const subjectRows = orderedSubjectsToProposalSubjectRows(
			subjects,
			proposalId,
		);
		const insertSubjectsResult = await db
			.from("match_review_proposal_subject")
			.insert(subjectRows);
		if (insertSubjectsResult.error)
			return Result.err(dbErr(insertSubjectsResult.error));

		const seedRows: ProposalSeedPairInsert[] = [];
		const seedWindow = subjects.slice(0, PROMOTION_SEED_SUBJECTS);
		for (let i = 0; i < seedWindow.length; i++) {
			const seedResult = await buildSeedForSubject(
				seedWindow[i].subject,
				accountId,
				snapshotId,
				minScore,
				proposalId,
				i,
			);
			if (Result.isError(seedResult)) return seedResult;
			seedRows.push(...seedResult.value);
		}
		if (seedRows.length > 0) {
			const insertSeedResult = await db
				.from("match_review_proposal_seed_pair")
				.insert(seedRows);
			if (insertSeedResult.error)
				return Result.err(dbErr(insertSeedResult.error));
		}
	}

	const readyResult = await db
		.from("match_review_proposal")
		.update({
			status: "ready",
			total_subjects: subjects.length,
			hidden_review_item_count: hiddenReviewItemCount,
		})
		.eq("id", proposalId);
	if (readyResult.error) return Result.err(dbErr(readyResult.error));

	return Result.ok(undefined);
}

/**
 * Builds proposals for all strictness presets for one (account, orientation,
 * snapshot), then — only when this snapshot IS the account's latest — marks
 * prior proposals for that account+orientation (older snapshots) stale (plan
 * §11.1). Without full pair storage a proposal is just subject rows + a small
 * seed, so building all presets is cheap and a preset change then finds a ready
 * proposal.
 *
 * One `nowMs` threads through every preset's hash + derivation so UTC-today
 * folding is consistent within the build.
 */
export async function buildProposalsForAccountOrientation(input: {
	accountId: string;
	orientation: MatchOrientation;
	snapshotId: string;
}): Promise<Result<void, DbError>> {
	const { accountId, orientation, snapshotId } = input;
	const nowMs = Date.now();

	for (const preset of MATCH_STRICTNESS_VALUES) {
		const built = await buildOneProposal(
			accountId,
			orientation,
			snapshotId,
			preset,
			STRICTNESS_MIN_SCORE[preset],
			nowMs,
		);
		if (Result.isError(built)) return built;
	}

	// Supersede older-snapshot proposals only after every preset for the current
	// snapshot is ready, so a mid-build failure never leaves the account without
	// a ready proposal. Bound to the case where THIS snapshot is the account's
	// latest: building/repairing an OLDER snapshot must never flip a newer
	// snapshot's ready proposals to stale (M3). The newer snapshot's own build
	// owns superseding everything before it.
	const latestResult = await getLatestMatchSnapshot(accountId);
	if (Result.isError(latestResult)) return latestResult;
	const latest = latestResult.value;
	if (latest && latest.id === snapshotId) {
		const staleResult = await createAdminSupabaseClient()
			.from("match_review_proposal")
			.update({ status: "stale" })
			.eq("account_id", accountId)
			.eq("orientation", orientation)
			.neq("snapshot_id", snapshotId)
			.in("status", ["building", "ready", "failed"]);
		if (staleResult.error) return Result.err(dbErr(staleResult.error));
	}

	return Result.ok(undefined);
}
