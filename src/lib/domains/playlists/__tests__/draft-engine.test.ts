/**
 * Tests for the playlist creation preview engine (pure domain logic).
 *
 * All tests operate on in-memory data — no DB calls, no server functions.
 * The goal is to verify: filter application, no-embedding weight redistribution,
 * intent eligibility, pinned-first / excluded-dropped ordering, the maxSongs
 * clamp + dropped-pin reporting, and suggestions slicing.
 */

import { describe, expect, it } from "vitest";
import { makeBillingState } from "@/lib/domains/billing/fixtures";
import type { BillingState } from "@/lib/domains/billing/state";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import { computeAdaptiveWeights } from "@/lib/domains/taste/song-matching/config";
import type { Phase1Candidate } from "../candidate-loader";
import { SUGGESTIONS_COUNT } from "../constants";
import type {
	ComposePlaylistPreviewInput,
	RankedCandidate,
} from "../draft-engine";
import {
	composePlaylistPreview,
	selectEligibleCandidates,
} from "../draft-engine";
import { buildIntentGate, isIntentEligible } from "../intent-eligibility";

// ============================================================================
// Test helpers
// ============================================================================

function makeCandidate(
	id: string,
	overrides: Partial<{
		genres: string[];
		language: string | null;
		releaseYear: number | null;
		vocalGender: string | null;
		likedAt: number | null;
		hasAudio: boolean;
	}> = {},
): Phase1Candidate {
	const opts = {
		genres: ["pop"],
		language: "en",
		releaseYear: 2020,
		vocalGender: null,
		likedAt: Date.now(),
		hasAudio: true,
		...overrides,
	};

	return {
		song: {
			id,
			spotifyId: `sp-${id}`,
			name: `Song ${id}`,
			artists: ["Artist"],
			genres: opts.genres,
			audioFeatures: opts.hasAudio
				? {
						energy: 0.7,
						valence: 0.5,
						danceability: 0.6,
						acousticness: 0.2,
						instrumentalness: 0.1,
						speechiness: 0.05,
						liveness: 0.1,
						tempo: 120,
						loudness: -10,
					}
				: null,
		},
		filterMeta: {
			language: opts.language,
			languageSecondary: null,
			releaseYear: opts.releaseYear,
			vocalGender: opts.vocalGender,
			likedAt: opts.likedAt,
		},
		display: {
			imageUrl: null,
			album: null,
			durationMs: null,
		},
	};
}

function makeRanking(
	candidates: Phase1Candidate[],
	scoreMap?: Map<string, number>,
): RankedCandidate[] {
	return candidates.map((c) => ({
		candidate: c,
		score: scoreMap?.get(c.song.id) ?? 0.5,
	}));
}

function compose(
	ranking: RankedCandidate[],
	overrides: Partial<ComposePlaylistPreviewInput> = {},
) {
	return composePlaylistPreview({
		ranking,
		pinnedSongIds: [],
		excludedSongIds: [],
		maxSongs: 15,
		intentApplied: false,
		totalEligible: ranking.length,
		...overrides,
	});
}

const freeBillingState: BillingState = makeBillingState();

const premiumBillingState: BillingState = {
	plan: "yearly",
	creditBalance: 0,
	subscriptionStatus: "active",
	cancelAtPeriodEnd: false,
	subscriptionPeriodEnd: null,
	unlimitedAccess: { kind: "subscription" },
	queueBand: "priority",
};

// ============================================================================
// selectEligibleCandidates
// ============================================================================

describe("selectEligibleCandidates", () => {
	const nowMs = new Date("2024-06-01T00:00:00Z").getTime();

	it("passes all candidates when filters are empty (version:1 only)", () => {
		const candidates = [
			makeCandidate("a"),
			makeCandidate("b"),
			makeCandidate("c"),
		];
		const filters: PlaylistMatchFiltersV1 = { version: 1 };
		const result = selectEligibleCandidates(candidates, filters, nowMs);
		expect(result).toHaveLength(3);
	});

	it("filters by language — only matching primary language passes", () => {
		const candidates = [
			makeCandidate("en", { language: "en" }),
			makeCandidate("pt", { language: "pt" }),
			makeCandidate("null", { language: null }),
		];
		const filters: PlaylistMatchFiltersV1 = {
			version: 1,
			languages: { codes: ["en"] },
		};
		const result = selectEligibleCandidates(candidates, filters, nowMs);
		expect(result.map((c) => c.song.id)).toEqual(["en"]);
	});

	it("filters by releaseYear — before filter", () => {
		const candidates = [
			makeCandidate("old", { releaseYear: 1999 }),
			makeCandidate("match", { releaseYear: 2000 }),
			makeCandidate("new", { releaseYear: 2010 }),
		];
		const filters: PlaylistMatchFiltersV1 = {
			version: 1,
			releaseYear: { kind: "before", end: 2000 },
		};
		const result = selectEligibleCandidates(candidates, filters, nowMs);
		expect(result.map((c) => c.song.id)).toEqual(["old", "match"]);
	});

	it("filters by releaseYear — range filter", () => {
		const candidates = [
			makeCandidate("a", { releaseYear: 1995 }),
			makeCandidate("b", { releaseYear: 2000 }),
			makeCandidate("c", { releaseYear: 2005 }),
			makeCandidate("d", { releaseYear: 2010 }),
		];
		const filters: PlaylistMatchFiltersV1 = {
			version: 1,
			releaseYear: { kind: "range", start: 2000, end: 2005 },
		};
		const result = selectEligibleCandidates(candidates, filters, nowMs);
		expect(result.map((c) => c.song.id)).toEqual(["b", "c"]);
	});

	it("filters by vocalGender", () => {
		const candidates = [
			makeCandidate("f", { vocalGender: "female" }),
			makeCandidate("m", { vocalGender: "male" }),
			makeCandidate("n", { vocalGender: null }),
		];
		const filters: PlaylistMatchFiltersV1 = {
			version: 1,
			vocalGender: "female",
		};
		const result = selectEligibleCandidates(candidates, filters, nowMs);
		expect(result.map((c) => c.song.id)).toEqual(["f"]);
	});

	it("filters by likedAt — after filter", () => {
		const afterDate = "2023-01-01";
		const beforeTs = new Date("2022-12-31T00:00:00Z").getTime();
		const afterTs = new Date("2023-06-01T00:00:00Z").getTime();
		const candidates = [
			makeCandidate("old", { likedAt: beforeTs }),
			makeCandidate("new", { likedAt: afterTs }),
		];
		const filters: PlaylistMatchFiltersV1 = {
			version: 1,
			likedAt: { kind: "after", startDate: afterDate },
		};
		const result = selectEligibleCandidates(candidates, filters, nowMs);
		expect(result.map((c) => c.song.id)).toEqual(["new"]);
	});

	it("applies multiple filters as AND (all must pass)", () => {
		const candidates = [
			makeCandidate("pass", {
				language: "en",
				releaseYear: 2005,
				vocalGender: "female",
			}),
			makeCandidate("wrong-lang", {
				language: "pt",
				releaseYear: 2005,
				vocalGender: "female",
			}),
			makeCandidate("wrong-year", {
				language: "en",
				releaseYear: 1990,
				vocalGender: "female",
			}),
			makeCandidate("wrong-gender", {
				language: "en",
				releaseYear: 2005,
				vocalGender: "male",
			}),
		];
		const filters: PlaylistMatchFiltersV1 = {
			version: 1,
			languages: { codes: ["en"] },
			releaseYear: { kind: "after", start: 2000 },
			vocalGender: "female",
		};
		const result = selectEligibleCandidates(candidates, filters, nowMs);
		expect(result.map((c) => c.song.id)).toEqual(["pass"]);
	});

	it("drops songs with null metadata when the corresponding filter is active", () => {
		const candidates = [
			makeCandidate("a", { releaseYear: null }),
			makeCandidate("b", { releaseYear: 2005 }),
		];
		const filters: PlaylistMatchFiltersV1 = {
			version: 1,
			releaseYear: { kind: "after", start: 2000 },
		};
		const result = selectEligibleCandidates(candidates, filters, nowMs);
		expect(result.map((c) => c.song.id)).toEqual(["b"]);
	});
});

// ============================================================================
// No-embedding weight redistribution (computeAdaptiveWeights)
// ============================================================================

describe("no-embedding weight redistribution", () => {
	it("default weights: embedding=0.5 redistributes to audio=0.6, genre=0.4", () => {
		const baseWeights = { embedding: 0.5, audio: 0.3, genre: 0.2 };
		const availability = {
			hasEmbedding: false,
			hasAudioFeatures: true,
			hasGenres: true,
		};
		const result = computeAdaptiveWeights(availability, baseWeights);
		expect(result.embedding).toBeCloseTo(0);
		// audio = 0.3 + 0.5 * (0.3 / 0.5) = 0.6
		expect(result.audio).toBeCloseTo(0.6);
		// genre = 0.2 + 0.5 * (0.2 / 0.5) = 0.4
		expect(result.genre).toBeCloseTo(0.4);
		// Weights sum to 1.0
		expect(result.embedding + result.audio + result.genre).toBeCloseTo(1.0);
	});

	it("pill weights: embedding=0.35 redistributes proportionally", () => {
		// pill weights: embedding=0.35, audio=0.25, genre=0.40
		const baseWeights = { embedding: 0.35, audio: 0.25, genre: 0.4 };
		const availability = {
			hasEmbedding: false,
			hasAudioFeatures: true,
			hasGenres: true,
		};
		const result = computeAdaptiveWeights(availability, baseWeights);
		expect(result.embedding).toBeCloseTo(0);
		// total available = 0.25 + 0.40 = 0.65
		// audio = 0.25 + 0.35 * (0.25 / 0.65)
		expect(result.audio).toBeCloseTo(0.25 + 0.35 * (0.25 / 0.65));
		// genre = 0.40 + 0.35 * (0.40 / 0.65)
		expect(result.genre).toBeCloseTo(0.4 + 0.35 * (0.4 / 0.65));
		// Weights sum to 1.0
		expect(result.embedding + result.audio + result.genre).toBeCloseTo(1.0);
	});

	it("no-embedding + no-audio: all weight goes to genre", () => {
		const baseWeights = { embedding: 0.5, audio: 0.3, genre: 0.2 };
		const availability = {
			hasEmbedding: false,
			hasAudioFeatures: false,
			hasGenres: true,
		};
		const result = computeAdaptiveWeights(availability, baseWeights);
		expect(result.embedding).toBeCloseTo(0);
		expect(result.audio).toBeCloseTo(0);
		expect(result.genre).toBeCloseTo(1.0);
	});

	it("all signals unavailable: weights are all zero (scores will be 0)", () => {
		const baseWeights = { embedding: 0.5, audio: 0.3, genre: 0.2 };
		const availability = {
			hasEmbedding: false,
			hasAudioFeatures: false,
			hasGenres: false,
		};
		const result = computeAdaptiveWeights(availability, baseWeights);
		expect(result.embedding).toBeCloseTo(0);
		expect(result.audio).toBeCloseTo(0);
		expect(result.genre).toBeCloseTo(0);
	});

	it("weights always sum to 1.0 when at least one signal is available", () => {
		const scenarios: Array<{
			hasEmbedding: boolean;
			hasAudioFeatures: boolean;
			hasGenres: boolean;
		}> = [
			{ hasEmbedding: true, hasAudioFeatures: true, hasGenres: true },
			{ hasEmbedding: false, hasAudioFeatures: true, hasGenres: true },
			{ hasEmbedding: false, hasAudioFeatures: false, hasGenres: true },
			{ hasEmbedding: true, hasAudioFeatures: false, hasGenres: true },
			{ hasEmbedding: true, hasAudioFeatures: true, hasGenres: false },
		];
		const baseWeights = { embedding: 0.5, audio: 0.3, genre: 0.2 };
		for (const availability of scenarios) {
			const result = computeAdaptiveWeights(availability, baseWeights);
			const sum = result.embedding + result.audio + result.genre;
			expect(sum).toBeCloseTo(1.0, 10);
		}
	});
});

// ============================================================================
// Intent eligibility
// ============================================================================

describe("isIntentEligible", () => {
	it("returns true for unlimited-access accounts", () => {
		expect(isIntentEligible(premiumBillingState)).toBe(true);
	});

	it("returns false for free accounts (pack path disabled)", () => {
		expect(isIntentEligible(freeBillingState)).toBe(false);
	});

	it("self-hosted billing state is always eligible", () => {
		const selfHostedState: BillingState = {
			...freeBillingState,
			unlimitedAccess: { kind: "self_hosted" },
		};
		expect(isIntentEligible(selfHostedState)).toBe(true);
	});
});

describe("buildIntentGate", () => {
	it("allows unlimited-access accounts via the Backstage Pass criterion", () => {
		const gate = buildIntentGate(premiumBillingState);

		expect(gate.allowed).toBe(true);
		expect(gate.criteria.find((c) => c.id === "backstage-pass")?.met).toBe(
			true,
		);
	});

	it("locks a free account with the Backstage Pass path unmet and no other path", () => {
		const gate = buildIntentGate(freeBillingState);

		expect(gate.allowed).toBe(false);
		const pass = gate.criteria.find((c) => c.id === "backstage-pass");
		expect(pass?.met).toBe(false);
		expect(gate.criteria).toHaveLength(1);
	});

	it("keeps allowed in lockstep with isIntentEligible", () => {
		for (const state of [freeBillingState, premiumBillingState]) {
			expect(buildIntentGate(state).allowed).toBe(isIntentEligible(state));
		}
	});
});

// ============================================================================
// composePlaylistPreview — pinned / excluded / maxSongs clamp / suggestions
// ============================================================================

describe("composePlaylistPreview", () => {
	it("returns empty tracklist and suggestions when there are no candidates", () => {
		const result = compose([], { totalEligible: 0 });
		expect(result.tracklist).toHaveLength(0);
		expect(result.suggestions).toHaveLength(0);
		expect(result.totalEligible).toBe(0);
	});

	it("caps the tracklist at maxSongs", () => {
		const candidates = Array.from({ length: 20 }, (_, i) =>
			makeCandidate(`song-${i}`),
		);
		const result = compose(makeRanking(candidates), { maxSongs: 5 });
		expect(result.tracklist).toHaveLength(5);
	});

	it("suggestions contains up to 12 songs after the tracklist slice", () => {
		const candidates = Array.from({ length: 30 }, (_, i) =>
			makeCandidate(`song-${i}`),
		);
		const result = compose(makeRanking(candidates), { maxSongs: 10 });
		expect(result.tracklist).toHaveLength(10);
		expect(result.suggestions).toHaveLength(12);
	});

	it("suggestions contains remaining songs when fewer than 12 remain", () => {
		const candidates = Array.from({ length: 12 }, (_, i) =>
			makeCandidate(`song-${i}`),
		);
		const result = compose(makeRanking(candidates), { maxSongs: 10 });
		expect(result.tracklist).toHaveLength(10);
		expect(result.suggestions).toHaveLength(2);
	});

	it("pinned songs appear first in the tracklist in the order specified by pinnedSongIds", () => {
		const candidates = [
			makeCandidate("a"),
			makeCandidate("b"),
			makeCandidate("c"),
			makeCandidate("d"),
		];
		// Score map: a=0.9, b=0.8, c=0.7, d=0.6
		const ranking = makeRanking(
			candidates,
			new Map([
				["a", 0.9],
				["b", 0.8],
				["c", 0.7],
				["d", 0.6],
			]),
		);
		// Pin d and c (lower-scored) — they should come first, in that order
		const result = compose(ranking, {
			pinnedSongIds: ["d", "c"],
			maxSongs: 4,
		});
		expect(result.tracklist[0].id).toBe("d");
		expect(result.tracklist[1].id).toBe("c");
		// Remaining slots filled by top-ranked non-pinned (a, b)
		expect(result.tracklist[2].id).toBe("a");
		expect(result.tracklist[3].id).toBe("b");
	});

	it("excluded songs never appear in the tracklist or suggestions", () => {
		const candidates = [
			makeCandidate("a"),
			makeCandidate("b"),
			makeCandidate("c"),
			makeCandidate("d"),
		];
		const ranking = makeRanking(
			candidates,
			new Map([
				["a", 0.9],
				["b", 0.8],
				["c", 0.7],
				["d", 0.6],
			]),
		);
		const result = compose(ranking, {
			excludedSongIds: ["b", "d"],
			maxSongs: 10,
		});
		const allIds = [
			...result.tracklist.map((s) => s.id),
			...result.suggestions.map((s) => s.id),
		];
		expect(allIds).not.toContain("b");
		expect(allIds).not.toContain("d");
		expect(allIds).toContain("a");
		expect(allIds).toContain("c");
	});

	it("excluded songs do not count toward tracklist slots", () => {
		const candidates = Array.from({ length: 10 }, (_, i) =>
			makeCandidate(`song-${i}`),
		);
		// Exclude the first 3 songs
		const excluded = ["song-0", "song-1", "song-2"];
		const result = compose(makeRanking(candidates), {
			excludedSongIds: excluded,
			maxSongs: 5,
		});
		// Tracklist should have 5 non-excluded songs
		expect(result.tracklist).toHaveLength(5);
		for (const s of result.tracklist) {
			expect(excluded).not.toContain(s.id);
		}
	});

	it("a pin that is also excluded is dropped and reported — exclusion wins", () => {
		const candidates = [makeCandidate("a"), makeCandidate("b")];
		const result = compose(makeRanking(candidates), {
			pinnedSongIds: ["a"],
			excludedSongIds: ["a"],
			maxSongs: 5,
		});
		expect(result.tracklist.map((s) => s.id)).not.toContain("a");
		expect(result.droppedPinnedSongIds).toEqual(["a"]);
	});

	it("clamps the tracklist to maxSongs when pins alone exceed it, reporting the cut pins", () => {
		const candidates = Array.from({ length: 10 }, (_, i) =>
			makeCandidate(`song-${i}`),
		);
		const pinnedSongIds = candidates.map((c) => c.song.id);
		const result = compose(makeRanking(candidates), {
			pinnedSongIds,
			maxSongs: 5,
		});
		expect(result.tracklist).toHaveLength(5);
		// First maxSongs pins survive in user order
		expect(result.tracklist.map((s) => s.id)).toEqual(
			pinnedSongIds.slice(0, 5),
		);
		// The rest are reported, not silently shown
		expect(result.droppedPinnedSongIds).toEqual(pinnedSongIds.slice(5));
		// Clamped pins do not re-enter the suggestions pool
		for (const s of result.suggestions) {
			expect(pinnedSongIds).not.toContain(s.id);
		}
	});

	it("reports pins missing from the ranking (filtered out / unliked)", () => {
		const candidates = [makeCandidate("a"), makeCandidate("b")];
		const result = compose(makeRanking(candidates), {
			pinnedSongIds: ["ghost", "a"],
			maxSongs: 5,
		});
		expect(result.tracklist.map((s) => s.id)).toContain("a");
		expect(result.droppedPinnedSongIds).toEqual(["ghost"]);
	});

	it("droppedPinnedSongIds is empty when every pin is honored", () => {
		const candidates = [makeCandidate("a"), makeCandidate("b")];
		const result = compose(makeRanking(candidates), {
			pinnedSongIds: ["b"],
			maxSongs: 5,
		});
		expect(result.droppedPinnedSongIds).toEqual([]);
	});

	it("intentApplied is passed through to the result", () => {
		const candidates = [makeCandidate("a")];
		const withIntent = compose(makeRanking(candidates), {
			intentApplied: true,
		});
		const withoutIntent = compose(makeRanking(candidates), {
			intentApplied: false,
		});
		expect(withIntent.intentApplied).toBe(true);
		expect(withoutIntent.intentApplied).toBe(false);
	});

	it("totalEligible is passed through to the result", () => {
		const candidates = Array.from({ length: 100 }, (_, i) =>
			makeCandidate(`song-${i}`),
		);
		const result = compose(makeRanking(candidates), { totalEligible: 100 });
		expect(result.totalEligible).toBe(100);
	});

	it("matchScore on SongVM matches the ranked value", () => {
		const candidates = [makeCandidate("a"), makeCandidate("b")];
		const ranking = makeRanking(
			candidates,
			new Map([
				["a", 0.77],
				["b", 0.55],
			]),
		);
		const result = compose(ranking, { maxSongs: 5 });
		// Ranking order: a (0.77) before b (0.55)
		expect(result.tracklist[0].id).toBe("a");
		expect(result.tracklist[0].matchScore).toBeCloseTo(0.77);
		expect(result.tracklist[1].id).toBe("b");
		expect(result.tracklist[1].matchScore).toBeCloseTo(0.55);
	});

	// ── suggestionsOffset — "Refresh suggestions" paging ──────────────────────

	it("defaults to the top-ranked window when suggestionsOffset is omitted", () => {
		const candidates = Array.from({ length: 30 }, (_, i) =>
			makeCandidate(`song-${i}`),
		);
		const ranking = makeRanking(candidates);
		const withoutOffset = compose(ranking, { maxSongs: 10 });
		const withZeroOffset = compose(ranking, {
			maxSongs: 10,
			suggestionsOffset: 0,
		});
		expect(withoutOffset.suggestions.map((s) => s.id)).toEqual(
			withZeroOffset.suggestions.map((s) => s.id),
		);
	});

	it("suggestionsOffset pages the suggestions window deeper into the ranked pool", () => {
		const candidates = Array.from({ length: 40 }, (_, i) =>
			makeCandidate(`song-${i}`),
		);
		const ranking = makeRanking(candidates);
		const firstBatch = compose(ranking, {
			maxSongs: 10,
			suggestionsOffset: 0,
		});
		const secondBatch = compose(ranking, {
			maxSongs: 10,
			suggestionsOffset: SUGGESTIONS_COUNT,
		});

		expect(firstBatch.suggestions).toHaveLength(SUGGESTIONS_COUNT);
		expect(secondBatch.suggestions).toHaveLength(SUGGESTIONS_COUNT);
		// Genuinely new songs — no overlap between the two pages.
		const firstIds = new Set(firstBatch.suggestions.map((s) => s.id));
		for (const song of secondBatch.suggestions) {
			expect(firstIds.has(song.id)).toBe(false);
		}
	});

	it("suggestionsOffset never changes the tracklist window", () => {
		const candidates = Array.from({ length: 40 }, (_, i) =>
			makeCandidate(`song-${i}`),
		);
		const ranking = makeRanking(candidates);
		const withoutOffset = compose(ranking, {
			maxSongs: 10,
			suggestionsOffset: 0,
		});
		const withOffset = compose(ranking, {
			maxSongs: 10,
			suggestionsOffset: 12,
		});
		expect(withOffset.tracklist.map((s) => s.id)).toEqual(
			withoutOffset.tracklist.map((s) => s.id),
		);
	});

	it("clamps an out-of-range suggestionsOffset instead of returning nothing", () => {
		const candidates = Array.from({ length: 20 }, (_, i) =>
			makeCandidate(`song-${i}`),
		);
		// Way past the end of the ranked pool
		const result = compose(makeRanking(candidates), {
			maxSongs: 10,
			suggestionsOffset: 1000,
		});
		expect(result.suggestions.length).toBeGreaterThan(0);
	});

	it("suggestionsOffset still respects excluded songs", () => {
		const candidates = Array.from({ length: 30 }, (_, i) =>
			makeCandidate(`song-${i}`),
		);
		const excluded = ["song-15", "song-16"];
		const result = compose(makeRanking(candidates), {
			excludedSongIds: excluded,
			maxSongs: 10,
			suggestionsOffset: 5,
		});
		const allIds = [
			...result.tracklist.map((s) => s.id),
			...result.suggestions.map((s) => s.id),
		];
		expect(allIds).not.toContain("song-15");
		expect(allIds).not.toContain("song-16");
	});
});
