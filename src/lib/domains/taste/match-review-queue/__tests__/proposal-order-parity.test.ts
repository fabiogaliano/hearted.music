/**
 * Proposal subject-order parity.
 *
 * A proposal's subject positions must equal the ordered subject list the
 * request-path append would have inserted. This is guaranteed BY CONSTRUCTION,
 * not by comparing against a shadow implementation: the proposal builder's
 * `deriveProposalSubjects` and the request-path append both call the same
 * pure `deriveEligibleSubjects` (the shared seam in `eligible-subjects.ts`),
 * so their subject order cannot diverge — there is only one derivation to
 * agree with itself.
 *
 * Two levels of coverage below: a hand-computed prefilter test that pins the
 * entitlement/ownership guard `deriveEligibleSubjects` applies before ordering
 * (ties, exclusions), and a fixture test that drives `deriveProposalSubjects`
 * end-to-end (its visibility-inputs read stubbed) and pins the exact
 * `match_review_proposal_subject` rows the builder would insert — order and
 * fields.
 */

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: vi.fn(),
}));
vi.mock("@/lib/domains/library/liked-songs/status-queries", () => ({
	getNewItemIds: vi.fn(),
}));
vi.mock("../visibility-inputs", () => ({
	loadVisibilityInputs: vi.fn(),
}));

import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getNewItemIds } from "@/lib/domains/library/liked-songs/status-queries";
import type { MatchResultRow } from "@/lib/domains/taste/song-matching/queries";
import {
	deriveEligibleSubjects,
	deriveProposalSubjects,
} from "../eligible-subjects";
import { orderedSubjectsToProposalSubjectRows } from "../proposal-builder";
import {
	loadVisibilityInputs,
	type VisibilityInputs,
} from "../visibility-inputs";
import type { VisibilityPolicy } from "../visibility-policy";

const NOW_MS = new Date("2024-06-01T00:00:00Z").getTime();

const mr = (
	song_id: string,
	playlist_id: string,
	score: number,
	fused_score: number | null = null,
): MatchResultRow => ({ song_id, playlist_id, score, fused_score });

describe("deriveEligibleSubjects — entitlement/ownership prefilter (hand-computed)", () => {
	it("maps subjects to contiguous positions in derived order, dropping non-eligible pairs", () => {
		const matchResults = [
			mr("song-b", "pl-1", 0.9),
			mr("song-a", "pl-1", 0.9),
			mr("song-c", "pl-2", 0.7),
			// non-entitled song → must not appear as a subject
			mr("song-x", "pl-1", 0.99),
			// song-a's only high pair is on a non-owned playlist → must not reorder it
			mr("song-a", "pl-unowned", 0.99),
		];
		const policy: VisibilityPolicy = {
			orientation: "song",
			minScore: 0.5,
			filtersByPlaylistId: new Map(),
		};

		const { subjects } = deriveEligibleSubjects({
			matchResults,
			decidedPairs: new Set(),
			policy,
			entitledSongIds: new Set(["song-a", "song-b", "song-c"]),
			ownedPlaylistIds: new Set(["pl-1", "pl-2"]),
			newSongIds: new Set(),
			songMetaBySongId: new Map(),
			nowMs: NOW_MS,
		});

		const rows = orderedSubjectsToProposalSubjectRows(subjects, "prop-1");

		// Positions are contiguous 0..n-1.
		expect(rows.map((r) => r.position)).toEqual(subjects.map((_, i) => i));

		// Reading rows back in position order reproduces the subject order exactly.
		const rowOrder = [...rows]
			.sort((a, b) => a.position - b.position)
			.map((r) => r.song_id);
		const subjectOrder = subjects.map((s) =>
			s.subject.orientation === "song" ? s.subject.songId : null,
		);
		expect(rowOrder).toEqual(subjectOrder);

		// Tie at 0.9 breaks by id asc, then the 0.7 pair; excluded pairs are gone.
		expect(subjectOrder).toEqual(["song-a", "song-b", "song-c"]);
		expect(rows.every((r) => r.orientation === "song")).toBe(true);
		expect(rows.every((r) => r.playlist_id === null)).toBe(true);
	});
});

function inputs(
	pairs: MatchResultRow[],
	eligible: { songs: string[]; playlists: string[] },
): VisibilityInputs {
	return {
		pairs,
		entitledSongIds: new Set(eligible.songs),
		ownedPlaylistIds: new Set(eligible.playlists),
		decidedPairs: new Set(),
		songMetaBySongId: new Map(),
		filtersByPlaylistId: new Map(),
		playlistsById: new Map(),
	};
}

describe("deriveProposalSubjects — fixture, end-to-end (stubbed inputs)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getNewItemIds).mockResolvedValue(Result.ok([]));
	});

	it("derives ordered subjects from the loaded inputs and pins the exact proposal_subject rows", async () => {
		vi.mocked(loadVisibilityInputs).mockResolvedValue(
			Result.ok(
				inputs(
					[
						mr("song-b", "pl-1", 0.9),
						mr("song-a", "pl-1", 0.9),
						mr("song-c", "pl-2", 0.7),
						// non-entitled song → must not appear as a subject
						mr("song-x", "pl-1", 0.99),
						// song-a's only high pair is on a non-owned playlist → must not reorder it
						mr("song-a", "pl-unowned", 0.99),
					],
					{
						songs: ["song-a", "song-b", "song-c"],
						playlists: ["pl-1", "pl-2"],
					},
				),
			),
		);

		const result = await deriveProposalSubjects(
			"acct-1",
			"song",
			"snap-1",
			0.5,
			NOW_MS,
		);

		expect(result).toBeOk();
		if (!Result.isOk(result)) return;

		const rows = orderedSubjectsToProposalSubjectRows(
			result.value.subjects,
			"prop-1",
		);

		expect(rows).toEqual([
			{
				proposal_id: "prop-1",
				position: 0,
				orientation: "song",
				song_id: "song-a",
				playlist_id: null,
				source_fit_score: 0.9,
				was_new_at_enqueue: false,
			},
			{
				proposal_id: "prop-1",
				position: 1,
				orientation: "song",
				song_id: "song-b",
				playlist_id: null,
				source_fit_score: 0.9,
				was_new_at_enqueue: false,
			},
			{
				proposal_id: "prop-1",
				position: 2,
				orientation: "song",
				song_id: "song-c",
				playlist_id: null,
				source_fit_score: 0.7,
				was_new_at_enqueue: false,
			},
		]);
	});

	it("emits playlist-mode subjects with playlist_id set, song_id null, in score order", async () => {
		vi.mocked(loadVisibilityInputs).mockResolvedValue(
			Result.ok(
				inputs(
					[
						mr("song-1", "pl-high", 0.95),
						mr("song-2", "pl-mid", 0.8),
						mr("song-3", "pl-low", 0.6),
					],
					{
						songs: ["song-1", "song-2", "song-3"],
						playlists: ["pl-high", "pl-mid", "pl-low"],
					},
				),
			),
		);

		const result = await deriveProposalSubjects(
			"acct-1",
			"playlist",
			"snap-1",
			0.5,
			NOW_MS,
		);

		expect(result).toBeOk();
		if (!Result.isOk(result)) return;

		const rows = orderedSubjectsToProposalSubjectRows(
			result.value.subjects,
			"prop-1",
		);
		expect(rows.map((r) => [r.position, r.playlist_id, r.song_id])).toEqual([
			[0, "pl-high", null],
			[1, "pl-mid", null],
			[2, "pl-low", null],
		]);
		expect(rows.every((r) => r.orientation === "playlist")).toBe(true);
	});
});
