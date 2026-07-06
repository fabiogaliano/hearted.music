/**
 * Promotion seed-pair parity.
 *
 * A proposal's seed rows must equal, field-for-field, the visible suggestions
 * the capture path derives — the builder captures the seed with the SAME
 * `deriveVisibleSuggestions` capture uses, then maps them with
 * `visibleSuggestionsToSeedPairRows`. These tests drive the pure derivation +
 * mapping on fixtures (no DB) and assert the seed rows mirror the suggestion
 * fields exactly, so promotion copies the same visible ranks the card shows.
 */

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: vi.fn(),
}));

import { describe, expect, it, vi } from "vitest";
import { visibleSuggestionsToSeedPairRows } from "../proposal-builder";
import type { MatchReviewSubject } from "../types";
import {
	deriveVisibleSuggestions,
	type MatchPairInput,
	type RankingInput,
} from "../visible-suggestion-list";

const NOW_MS = new Date("2024-06-01T00:00:00Z").getTime();

describe("seed rows == deriveVisibleSuggestions output (song subject)", () => {
	const subject: MatchReviewSubject = { orientation: "song", songId: "song-1" };
	const pairs: MatchPairInput[] = [
		{ songId: "song-1", playlistId: "pl-a", score: 0.9, fusedScore: null },
		{ songId: "song-1", playlistId: "pl-b", score: 0.7, fusedScore: null },
		{ songId: "song-1", playlistId: "pl-c", score: 0.3, fusedScore: null },
	];
	const rankings: RankingInput[] = [
		{ songId: "song-1", playlistId: "pl-a", rank: 1, orderingScore: 0.9 },
		{ songId: "song-1", playlistId: "pl-b", rank: 2, orderingScore: 0.7 },
	];

	it("maps every suggestion field-for-field, at the given subject position", () => {
		const suggestions = deriveVisibleSuggestions(
			subject,
			pairs,
			rankings,
			new Set(),
			0.5,
			NOW_MS,
		);
		// pl-c is below the 0.5 bar, so it must not appear in either output.
		expect(suggestions.map((s) => s.playlistId)).toEqual(["pl-a", "pl-b"]);

		const rows = visibleSuggestionsToSeedPairRows(suggestions, "prop-1", 2);
		expect(rows).toHaveLength(suggestions.length);
		rows.forEach((row, i) => {
			const s = suggestions[i];
			expect(row).toEqual({
				proposal_id: "prop-1",
				subject_position: 2,
				song_id: s.songId,
				playlist_id: s.playlistId,
				fit_score: s.fitScore,
				model_rank: s.modelRank,
				visible_rank: s.visibleRank,
			});
		});
	});

	it("excludes decided pairs from the seed exactly as the card would", () => {
		const suggestions = deriveVisibleSuggestions(
			subject,
			pairs,
			rankings,
			new Set(["song-1:pl-a"]),
			0.5,
			NOW_MS,
		);
		const rows = visibleSuggestionsToSeedPairRows(suggestions, "prop-1", 0);
		expect(rows.map((r) => r.playlist_id)).toEqual(["pl-b"]);
		expect(rows[0].visible_rank).toBe(1);
	});
});

describe("seed rows == deriveVisibleSuggestions output (playlist subject)", () => {
	it("carries the suggestion-song side onto the seed rows", () => {
		const subject: MatchReviewSubject = {
			orientation: "playlist",
			playlistId: "pl-1",
		};
		const pairs: MatchPairInput[] = [
			{ songId: "song-hi", playlistId: "pl-1", score: 0.95, fusedScore: null },
			{ songId: "song-lo", playlistId: "pl-1", score: 0.6, fusedScore: null },
		];
		const rankings: RankingInput[] = [
			{ songId: "song-hi", playlistId: "pl-1", rank: 1, orderingScore: 0.95 },
			{ songId: "song-lo", playlistId: "pl-1", rank: 2, orderingScore: 0.6 },
		];
		const suggestions = deriveVisibleSuggestions(
			subject,
			pairs,
			rankings,
			new Set(),
			0.5,
			NOW_MS,
		);
		const rows = visibleSuggestionsToSeedPairRows(suggestions, "prop-9", 1);
		expect(rows.map((r) => r.song_id)).toEqual(["song-hi", "song-lo"]);
		expect(rows.every((r) => r.playlist_id === "pl-1")).toBe(true);
		expect(rows.every((r) => r.subject_position === 1)).toBe(true);
	});
});
