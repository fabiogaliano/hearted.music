/**
 * Unit tests for the pure review-subject selector.
 *
 * getOrderedUndecidedSubjects derives ordered queue subjects under one
 * VisibilityPolicy (strictness + playlist filters). These tests drive it
 * directly with no DB — the same MatchResultRow shape getMatchResults returns
 * plus the song metadata the filter step needs.
 */

import { describe, expect, it } from "vitest";
import type { SongFilterMetadata } from "@/lib/domains/taste/match-filters/predicates";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import type { MatchResultRow } from "@/lib/domains/taste/song-matching/queries";
import { getOrderedUndecidedSubjects } from "../review-subject-selector";
import type { VisibilityPolicy } from "../visibility-policy";

const NOW_MS = new Date("2024-06-01T00:00:00Z").getTime();

const mr = (
	song_id: string,
	playlist_id: string,
	score: number,
	fused_score: number | null = null,
): MatchResultRow => ({ song_id, playlist_id, score, fused_score });

function songPolicy(
	minScore: number,
	filtersByPlaylistId: Map<string, PlaylistMatchFiltersV1 | null> = new Map(),
): VisibilityPolicy {
	return { orientation: "song", minScore, filtersByPlaylistId };
}

function playlistPolicy(
	minScore: number,
	filtersByPlaylistId: Map<string, PlaylistMatchFiltersV1 | null> = new Map(),
): VisibilityPolicy {
	return { orientation: "playlist", minScore, filtersByPlaylistId };
}

function run(input: {
	matchResults: MatchResultRow[];
	policy: VisibilityPolicy;
	decidedPairs?: ReadonlySet<string>;
	newSongIds?: ReadonlySet<string>;
	songMetaBySongId?: ReadonlyMap<string, SongFilterMetadata>;
}) {
	return getOrderedUndecidedSubjects({
		matchResults: input.matchResults,
		decidedPairs: input.decidedPairs ?? new Set(),
		policy: input.policy,
		newSongIds: input.newSongIds ?? new Set(),
		songMetaBySongId: input.songMetaBySongId ?? new Map(),
		nowMs: NOW_MS,
	});
}

describe("getOrderedUndecidedSubjects — song mode (strictness only)", () => {
	it("returns subjects with wasNewAtEnqueue from the newness set", () => {
		const { subjects } = run({
			matchResults: [mr("song-new", "pl-A", 0.9), mr("song-old", "pl-B", 0.8)],
			policy: songPolicy(0.5),
			newSongIds: new Set(["song-new"]),
		});
		const newSubject = subjects.find(
			(s) =>
				s.subject.orientation === "song" && s.subject.songId === "song-new",
		);
		const oldSubject = subjects.find(
			(s) =>
				s.subject.orientation === "song" && s.subject.songId === "song-old",
		);
		expect(newSubject?.wasNewAtEnqueue).toBe(true);
		expect(oldSubject?.wasNewAtEnqueue).toBe(false);
	});

	it("orders new songs before non-new regardless of score", () => {
		const { subjects } = run({
			matchResults: [
				mr("song-high", "pl-A", 0.99),
				mr("song-new-low", "pl-B", 0.5),
			],
			policy: songPolicy(0.3),
			newSongIds: new Set(["song-new-low"]),
		});
		expect(subjects[0]?.subject).toMatchObject({
			orientation: "song",
			songId: "song-new-low",
		});
	});

	it("within the same newness bucket, sorts by max score desc then id asc", () => {
		const { subjects } = run({
			matchResults: [
				mr("z-song", "pl-A", 0.8),
				mr("a-song", "pl-B", 0.8),
				mr("song-high", "pl-C", 0.95),
			],
			policy: songPolicy(0.5),
		});
		const ids = subjects.map((s) =>
			s.subject.orientation === "song" ? s.subject.songId : "",
		);
		expect(ids).toEqual(["song-high", "a-song", "z-song"]);
	});

	it("excludes songs whose only matches are below the threshold", () => {
		const { subjects, hiddenReviewItemCount } = run({
			matchResults: [
				mr("song-visible", "pl-A", 0.8),
				mr("song-hidden", "pl-B", 0.3),
			],
			policy: songPolicy(0.5),
		});
		const ids = subjects.map((s) =>
			s.subject.orientation === "song" ? s.subject.songId : "",
		);
		expect(ids).toEqual(["song-visible"]);
		expect(hiddenReviewItemCount).toBe(1);
	});

	it("excludes songs where all above-threshold pairs are decided", () => {
		const { subjects } = run({
			matchResults: [mr("song-1", "pl-A", 0.7), mr("song-1", "pl-B", 0.6)],
			policy: songPolicy(0.5),
			decidedPairs: new Set(["song-1:pl-A", "song-1:pl-B"]),
		});
		expect(subjects).toHaveLength(0);
	});

	it("records the max visible score as maxScore", () => {
		const { subjects } = run({
			matchResults: [mr("song-1", "pl-A", 0.9), mr("song-1", "pl-B", 0.6)],
			policy: songPolicy(0.5),
		});
		expect(subjects[0]?.maxScore).toBeCloseTo(0.9);
	});
});

describe("getOrderedUndecidedSubjects — song mode (filters)", () => {
	const enFilter = new Map<string, PlaylistMatchFiltersV1 | null>([
		["pl-A", { version: 1, languages: { codes: ["en"] } }],
	]);
	const enMeta: SongFilterMetadata = {
		language: "en",
		languageSecondary: null,
		releaseYear: 2020,
		vocalGender: null,
		likedAt: null,
	};

	it("does not queue a song whose only strictness-passing pair is filter-hidden", () => {
		// song-1 has one pair (pl-A, 0.9) that clears strictness but its song
		// metadata is absent, so the active language filter on pl-A hides it.
		const { subjects, hiddenReviewItemCount } = run({
			matchResults: [mr("song-1", "pl-A", 0.9)],
			policy: songPolicy(0.5, enFilter),
			songMetaBySongId: new Map(), // song-1 absent → all-null → fails en filter
		});
		expect(subjects).toHaveLength(0);
		// The song is undecided but hidden by the policy, so it counts as hidden.
		expect(hiddenReviewItemCount).toBe(1);
	});

	it("queues a song with one filter-hidden pair and one visible pair, using the visible pair's score", () => {
		// pl-A (0.95) is filter-hidden (no metadata for en filter); pl-B (0.7) has
		// no filter and is visible. The song is queued and maxScore is the visible
		// pair's score (0.7), not the hidden higher-scoring pair (0.95).
		const { subjects, hiddenReviewItemCount } = run({
			matchResults: [mr("song-1", "pl-A", 0.95), mr("song-1", "pl-B", 0.7)],
			policy: songPolicy(0.5, enFilter),
			songMetaBySongId: new Map(),
		});
		expect(subjects).toHaveLength(1);
		expect(subjects[0]?.subject).toMatchObject({
			orientation: "song",
			songId: "song-1",
		});
		expect(subjects[0]?.maxScore).toBeCloseTo(0.7);
		expect(hiddenReviewItemCount).toBe(0);
	});

	it("queues a song whose pair passes the active filter with matching metadata", () => {
		const { subjects } = run({
			matchResults: [mr("song-1", "pl-A", 0.9)],
			policy: songPolicy(0.5, enFilter),
			songMetaBySongId: new Map([["song-1", enMeta]]),
		});
		expect(subjects).toHaveLength(1);
		expect(subjects[0]?.maxScore).toBeCloseTo(0.9);
	});
});

describe("getOrderedUndecidedSubjects — playlist mode", () => {
	it("sets wasNewAtEnqueue=false for all playlist subjects", () => {
		const { subjects } = run({
			matchResults: [mr("song-1", "pl-A", 0.9)],
			policy: playlistPolicy(0.5),
			newSongIds: new Set(["song-1"]),
		});
		expect(subjects[0]?.wasNewAtEnqueue).toBe(false);
	});

	it("orders playlists by max score desc then playlist id asc", () => {
		const { subjects } = run({
			matchResults: [
				mr("song-1", "pl-low", 0.6),
				mr("song-2", "pl-high", 0.95),
				mr("song-3", "pl-mid", 0.8),
			],
			policy: playlistPolicy(0.5),
		});
		const ids = subjects.map((s) =>
			s.subject.orientation === "playlist" ? s.subject.playlistId : "",
		);
		expect(ids).toEqual(["pl-high", "pl-mid", "pl-low"]);
	});

	it("counts hidden playlists below threshold as hiddenReviewItemCount", () => {
		const { subjects, hiddenReviewItemCount } = run({
			matchResults: [
				mr("song-1", "pl-visible", 0.8),
				mr("song-2", "pl-hidden", 0.3),
			],
			policy: playlistPolicy(0.5),
		});
		expect(subjects).toHaveLength(1);
		expect(hiddenReviewItemCount).toBe(1);
	});

	it("takes max score across all visible songs for a playlist subject", () => {
		const { subjects } = run({
			matchResults: [mr("song-1", "pl-A", 0.6), mr("song-2", "pl-A", 0.9)],
			policy: playlistPolicy(0.5),
		});
		expect(subjects).toHaveLength(1);
		expect(subjects[0]?.maxScore).toBeCloseTo(0.9);
	});

	it("does not queue a playlist whose only suggestion songs are filter-hidden", () => {
		// pl-A filters to English; both suggestion songs have absent metadata, so
		// every pair is filter-hidden and the playlist must not be queued.
		const enFilter = new Map<string, PlaylistMatchFiltersV1 | null>([
			["pl-A", { version: 1, languages: { codes: ["en"] } }],
		]);
		const { subjects, hiddenReviewItemCount } = run({
			matchResults: [mr("song-1", "pl-A", 0.9), mr("song-2", "pl-A", 0.8)],
			policy: playlistPolicy(0.5, enFilter),
			songMetaBySongId: new Map(),
		});
		expect(subjects).toHaveLength(0);
		expect(hiddenReviewItemCount).toBe(1);
	});

	it("uses the visible suggestion song's score when another is filter-hidden", () => {
		const enFilter = new Map<string, PlaylistMatchFiltersV1 | null>([
			["pl-A", { version: 1, languages: { codes: ["en"] } }],
		]);
		const enMeta: SongFilterMetadata = {
			language: "en",
			languageSecondary: null,
			releaseYear: null,
			vocalGender: null,
			likedAt: null,
		};
		// song-hi (0.95) is filter-hidden (no metadata); song-lo (0.7) matches en.
		const { subjects } = run({
			matchResults: [mr("song-hi", "pl-A", 0.95), mr("song-lo", "pl-A", 0.7)],
			policy: playlistPolicy(0.5, enFilter),
			songMetaBySongId: new Map([["song-lo", enMeta]]),
		});
		expect(subjects).toHaveLength(1);
		expect(subjects[0]?.maxScore).toBeCloseTo(0.7);
	});
});
