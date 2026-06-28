/**
 * Review-subject selector — pure queue derivation.
 *
 * Turns a snapshot's match results into the ordered list of subjects that are
 * eligible to enter the review queue, applying one VisibilityPolicy (strictness
 * + playlist filters) rather than independent visibility logic. Card
 * presentation (visible-suggestion-list) evaluates the same policy, so a subject
 * is queue-eligible exactly when at least one of its pairs would be visible on
 * the card.
 *
 * Pure: no DB calls. Accepts the MatchResultRow shape getMatchResults returns
 * plus the song metadata the policy's filter step needs, so callers share one
 * query result.
 */

import type { SongFilterMetadata } from "@/lib/domains/taste/match-filters/predicates";
import type { MatchResultRow } from "@/lib/domains/taste/song-matching/queries";
import { strictnessScore } from "@/lib/domains/taste/song-matching/strictness";
import type { OrderedSubject } from "./types";
import {
	passesVisibilityPolicyForPair,
	type VisibilityPolicy,
} from "./visibility-policy";

interface SelectorInput {
	matchResults: MatchResultRow[];
	decidedPairs: ReadonlySet<string>;
	policy: VisibilityPolicy;
	newSongIds: ReadonlySet<string>;
	songMetaBySongId: ReadonlyMap<string, SongFilterMetadata>;
	nowMs: number;
}

interface VisibleSong {
	songId: string;
	maxScore: number;
	isNew: boolean;
}

interface VisiblePlaylist {
	playlistId: string;
	maxScore: number;
}

/**
 * Song-mode derivation.
 *
 * A song subject is eligible when at least one of its pairs passes the full
 * policy (undecided + strictness + that pair's playlist filters). maxScore is
 * the max strictness score among *visible* pairs — never a pair hidden by
 * filters or strictness.
 *
 * Ordering: new songs first, max visible score desc, song id asc.
 */
function deriveVisibleSongs(input: SelectorInput): {
	subjects: OrderedSubject[];
	hiddenReviewItemCount: number;
} {
	const {
		matchResults,
		decidedPairs,
		policy,
		newSongIds,
		songMetaBySongId,
		nowMs,
	} = input;

	// "Broad undecided": any song with at least one undecided pair, ignoring
	// strictness and filters — the denominator for the hidden count.
	const broadUndecided = new Set<string>();
	// Max strictness score among visible (policy-passing) pairs, per song.
	const visibleMaxScore = new Map<string, number>();

	for (const mr of matchResults) {
		if (!decidedPairs.has(`${mr.song_id}:${mr.playlist_id}`)) {
			broadUndecided.add(mr.song_id);
		}
		if (
			passesVisibilityPolicyForPair({
				row: mr,
				policy,
				decidedPairs,
				songMetaBySongId,
				nowMs,
			})
		) {
			visibleMaxScore.set(
				mr.song_id,
				Math.max(visibleMaxScore.get(mr.song_id) ?? 0, strictnessScore(mr)),
			);
		}
	}

	const visible: VisibleSong[] = [...visibleMaxScore.entries()].map(
		([songId, maxScore]) => ({
			songId,
			maxScore,
			isNew: newSongIds.has(songId),
		}),
	);

	const sorted = visible.toSorted((a, b) => {
		const aNew = a.isNew ? 1 : 0;
		const bNew = b.isNew ? 1 : 0;
		if (aNew !== bNew) return bNew - aNew;
		if (b.maxScore !== a.maxScore) return b.maxScore - a.maxScore;
		return a.songId.localeCompare(b.songId);
	});

	return {
		subjects: sorted.map((s) => ({
			subject: { orientation: "song" as const, songId: s.songId },
			maxScore: s.maxScore,
			wasNewAtEnqueue: s.isNew,
		})),
		hiddenReviewItemCount: broadUndecided.size - visibleMaxScore.size,
	};
}

/**
 * Playlist-mode derivation.
 *
 * A playlist subject is eligible when at least one of its pairs passes the full
 * policy (undecided + strictness + the playlist's filters against the suggestion
 * song's metadata). maxScore is the max strictness score among *visible* pairs.
 *
 * Ordering: max visible score desc, playlist id asc (no newness tier — playlist
 * subjects always carry wasNewAtEnqueue=false).
 */
function deriveVisiblePlaylists(input: SelectorInput): {
	subjects: OrderedSubject[];
	hiddenReviewItemCount: number;
} {
	const { matchResults, decidedPairs, policy, songMetaBySongId, nowMs } = input;

	const broadUndecided = new Set<string>();
	const visibleMaxScore = new Map<string, number>();

	for (const mr of matchResults) {
		if (!decidedPairs.has(`${mr.song_id}:${mr.playlist_id}`)) {
			broadUndecided.add(mr.playlist_id);
		}
		if (
			passesVisibilityPolicyForPair({
				row: mr,
				policy,
				decidedPairs,
				songMetaBySongId,
				nowMs,
			})
		) {
			visibleMaxScore.set(
				mr.playlist_id,
				Math.max(visibleMaxScore.get(mr.playlist_id) ?? 0, strictnessScore(mr)),
			);
		}
	}

	const visible: VisiblePlaylist[] = [...visibleMaxScore.entries()].map(
		([playlistId, maxScore]) => ({ playlistId, maxScore }),
	);

	const sorted = visible.toSorted((a, b) => {
		if (b.maxScore !== a.maxScore) return b.maxScore - a.maxScore;
		return a.playlistId.localeCompare(b.playlistId);
	});

	return {
		subjects: sorted.map((p) => ({
			subject: { orientation: "playlist" as const, playlistId: p.playlistId },
			maxScore: p.maxScore,
			// Playlist subjects never carry a newness flag (MSR-19 scope).
			wasNewAtEnqueue: false,
		})),
		hiddenReviewItemCount: broadUndecided.size - visibleMaxScore.size,
	};
}

/**
 * Derives orientation-aware ordered undecided queue subjects under one
 * VisibilityPolicy.
 *
 * Returns subjects plus hiddenReviewItemCount: the count of undecided subjects
 * hidden by the current visibility policy — those with at least one undecided
 * pair but none visible under strictness *and* filters. Entitlement/ownership is
 * the caller's responsibility and not included in this count.
 */
export function getOrderedUndecidedSubjects(input: SelectorInput): {
	subjects: OrderedSubject[];
	hiddenReviewItemCount: number;
} {
	return input.policy.orientation === "song"
		? deriveVisibleSongs(input)
		: deriveVisiblePlaylists(input);
}
