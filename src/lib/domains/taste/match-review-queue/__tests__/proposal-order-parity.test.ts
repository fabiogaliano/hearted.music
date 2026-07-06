/**
 * Proposal subject-order parity.
 *
 * A proposal's subject positions must equal the ordered subject list the
 * request-path append would have inserted. This is guaranteed by construction:
 * the proposal builder derives subjects via `deriveProposalSubjects`, which runs
 * the SAME pure `deriveEligibleSubjects` that service.appendSnapshotDelta runs,
 * then maps them with `orderedSubjectsToProposalSubjectRows` (position = index).
 * These tests drive the pure derivation + mapping on fixtures (no DB) and assert
 * the position order is the subject order, and that both derivation entrypoints
 * live in the one shared module — so parity is by construction, not convention.
 */

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: vi.fn(),
}));

import { describe, expect, it, vi } from "vitest";
import type { MatchResultRow } from "@/lib/domains/taste/song-matching/queries";
import {
	deriveEligibleSubjects,
	deriveProposalSubjects,
} from "../eligible-subjects";
import { orderedSubjectsToProposalSubjectRows } from "../proposal-builder";
import type { OrderedSubject } from "../types";
import type { VisibilityPolicy } from "../visibility-policy";

const NOW_MS = new Date("2024-06-01T00:00:00Z").getTime();

const mr = (
	song_id: string,
	playlist_id: string,
	score: number,
	fused_score: number | null = null,
): MatchResultRow => ({ song_id, playlist_id, score, fused_score });

describe("proposal subject order == derived subject order (song mode)", () => {
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

	it("carries source_fit_score (max visible) and was_new_at_enqueue onto the rows", () => {
		const matchResults = [mr("song-1", "pl-1", 0.9), mr("song-1", "pl-2", 0.6)];
		const policy: VisibilityPolicy = {
			orientation: "song",
			minScore: 0.5,
			filtersByPlaylistId: new Map(),
		};
		const { subjects } = deriveEligibleSubjects({
			matchResults,
			decidedPairs: new Set(),
			policy,
			entitledSongIds: new Set(["song-1"]),
			ownedPlaylistIds: new Set(["pl-1", "pl-2"]),
			newSongIds: new Set(["song-1"]),
			songMetaBySongId: new Map(),
			nowMs: NOW_MS,
		});
		const rows = orderedSubjectsToProposalSubjectRows(subjects, "prop-1");
		expect(rows).toHaveLength(1);
		expect(rows[0].source_fit_score).toBeCloseTo(0.9);
		expect(rows[0].was_new_at_enqueue).toBe(true);
	});
});

describe("proposal subject order == derived subject order (playlist mode)", () => {
	it("emits playlist subjects with playlist_id set and song_id null", () => {
		const matchResults = [
			mr("song-1", "pl-high", 0.95),
			mr("song-2", "pl-mid", 0.8),
			mr("song-3", "pl-low", 0.6),
		];
		const policy: VisibilityPolicy = {
			orientation: "playlist",
			minScore: 0.5,
			filtersByPlaylistId: new Map(),
		};
		const { subjects } = deriveEligibleSubjects({
			matchResults,
			decidedPairs: new Set(),
			policy,
			entitledSongIds: new Set(["song-1", "song-2", "song-3"]),
			ownedPlaylistIds: new Set(["pl-high", "pl-mid", "pl-low"]),
			newSongIds: new Set(),
			songMetaBySongId: new Map(),
			nowMs: NOW_MS,
		});
		const rows = orderedSubjectsToProposalSubjectRows(subjects, "prop-1");
		const rowOrder = [...rows]
			.sort((a, b) => a.position - b.position)
			.map((r) => r.playlist_id);
		expect(rowOrder).toEqual(["pl-high", "pl-mid", "pl-low"]);
		expect(rows.every((r) => r.orientation === "playlist")).toBe(true);
		expect(rows.every((r) => r.song_id === null)).toBe(true);
	});
});

describe("mapping preserves order for any subject sequence (construction guard)", () => {
	it("position === index and never reorders", () => {
		const subjects: OrderedSubject[] = [
			{
				subject: { orientation: "song", songId: "z" },
				maxScore: 0.9,
				wasNewAtEnqueue: false,
			},
			{
				subject: { orientation: "song", songId: "a" },
				maxScore: 0.8,
				wasNewAtEnqueue: true,
			},
			{
				subject: { orientation: "song", songId: "m" },
				maxScore: 0.7,
				wasNewAtEnqueue: false,
			},
		];
		const rows = orderedSubjectsToProposalSubjectRows(subjects, "prop-1");
		expect(rows.map((r) => [r.position, r.song_id])).toEqual([
			[0, "z"],
			[1, "a"],
			[2, "m"],
		]);
	});

	it("both derivation entrypoints are exported from the one shared module", () => {
		// service.appendSnapshotDelta imports deriveEligibleSubjects; the proposal
		// builder imports deriveProposalSubjects (which wraps deriveEligibleSubjects)
		// — both from eligible-subjects.ts, so they cannot silently diverge.
		expect(typeof deriveEligibleSubjects).toBe("function");
		expect(typeof deriveProposalSubjects).toBe("function");
	});
});
