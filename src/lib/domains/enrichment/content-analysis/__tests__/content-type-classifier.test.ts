/**
 * §12.2 partial — Classifier tests covering Decision 3 precedence.
 *
 * Each test case corresponds to a real song from the design.md evidence table
 * or a scenario from the spec. The classifier is exercised through the public
 * classifyContentType method exposed on SongAnalysisService.
 */

import { describe, expect, it } from "vitest";
import type { AnalyzeSongInput } from "../song-analysis";
import { SongAnalysisService } from "../song-analysis";

// classifyContentType is public, so we can call it directly without mocking
// the LLM. We pass a stub LLM because the constructor requires it.
const svc = new SongAnalysisService({} as never);
const classify = (input: Partial<AnalyzeSongInput>) =>
	svc.classifyContentType({
		songId: "test",
		artist: "Test",
		title: "Test",
		...input,
	});

// ─── Step 1: confirmed-instrumental fetch outcome ─────────────────────────────

describe("Step 1 — confirmed-instrumental fetch outcome wins", () => {
	it("LRCLIB instrumental flag → instrumental, even with lyrics-like text", () => {
		// Saib / in your arms: Genius wrongly matched; LRCLIB is the truth
		expect(
			classify({
				fetchOutcome: { kind: "instrumental", source: "lrclib" },
				lyrics: "some words here ".repeat(10),
				instrumentalness: 0.01,
				genres: ["instrumental hip-hop"],
			}),
		).toBe("instrumental");
	});

	it("genius_page instrumental → instrumental (Brock Berrigan Crossing Paths)", () => {
		expect(
			classify({
				fetchOutcome: { kind: "instrumental", source: "genius_page" },
				lyrics: "",
				instrumentalness: undefined,
			}),
		).toBe("instrumental");
	});

	it("genius_page beats a high instrumentalness reading the same way", () => {
		expect(
			classify({
				fetchOutcome: { kind: "instrumental", source: "genius_page" },
				instrumentalness: 0.95,
			}),
		).toBe("instrumental");
	});
});

// ─── Step 2: real lyrics in hand → lyrical ───────────────────────────────────

describe("Step 2 — real lyrics beat audio heuristics", () => {
	it("lyrics present + instrumentalness 0.70 → lyrical (Hot Chip Need You Now)", () => {
		expect(
			classify({
				fetchOutcome: {
					kind: "lyrics",
					text: "word ".repeat(60),
					source: "genius",
					confidence: 0.85,
				},
				lyrics: "word ".repeat(60),
				instrumentalness: 0.7,
			}),
		).toBe("lyrical");
	});

	it("lyrics present + no fetch outcome → lyrical when word count ≥ 50", () => {
		expect(
			classify({
				lyrics: "word ".repeat(60),
				instrumentalness: 0.8,
			}),
		).toBe("lyrical");
	});

	it("lyrics present but below word floor → does not classify lyrical", () => {
		// Fewer than 50 words does not count as "real lyrics"
		expect(
			classify({
				lyrics: "word ".repeat(30),
				instrumentalness: 0.0,
			}),
		).not.toBe("lyrical");
	});

	it("not_found fetch outcome + no lyrics → falls through to genre/instrumentalness", () => {
		// not_found is NOT a step-2 trigger; it just means no text to use.
		// With no genre and no instrumentalness, result is unknown.
		expect(
			classify({
				fetchOutcome: { kind: "not_found" },
				lyrics: "",
				instrumentalness: 0.5,
			}),
		).toBe("unknown");
	});
});

// ─── Step 3: genre keyword match ─────────────────────────────────────────────

describe("Step 3 — genre keyword catches instrumental (Saib tracks)", () => {
	it("instrumental hip-hop genre + instrumentalness 0.03 → instrumental", () => {
		// Saib — When It Rains: no lyrics, genre signals instrumental
		expect(
			classify({
				lyrics: "",
				genres: ["instrumental", "instrumental hip-hop"],
				instrumentalness: 0.03,
			}),
		).toBe("instrumental");
	});

	it("ambient genre → instrumental", () => {
		expect(
			classify({
				lyrics: "",
				genres: ["ambient"],
				instrumentalness: 0.3,
			}),
		).toBe("instrumental");
	});

	it("classical genre → instrumental", () => {
		expect(
			classify({
				lyrics: "",
				genres: ["classical"],
			}),
		).toBe("instrumental");
	});

	it("post-rock genre → instrumental", () => {
		expect(
			classify({
				lyrics: "",
				genres: ["post-rock"],
			}),
		).toBe("instrumental");
	});

	it("neoclassical genre → instrumental", () => {
		expect(
			classify({
				lyrics: "",
				genres: ["neoclassical"],
			}),
		).toBe("instrumental");
	});

	it("generic electronic genres do NOT gate (house, techno, deep house, electronic)", () => {
		// Daft Punk Veridis Quo is electronic/house but is detected via step 4 (instrumentalness).
		// Plain "house" + no other signal → unknown (not instrumental via genre alone).
		expect(
			classify({
				lyrics: "",
				genres: ["electronic", "house", "deep house", "techno"],
				instrumentalness: 0.5,
			}),
		).toBe("unknown");
	});

	it("genre matching is case-insensitive", () => {
		expect(
			classify({
				lyrics: "",
				genres: ["Instrumental Hip-Hop"],
			}),
		).toBe("instrumental");
	});
});

// ─── Step 4: instrumentalness ≥ 0.9 ─────────────────────────────────────────

describe("Step 4 — high-extreme instrumentalness (Daft Punk Veridis Quo)", () => {
	it("instrumentalness 0.949 → instrumental", () => {
		// Daft Punk — Veridis Quo: electronic/house genres, but step 4 catches it
		expect(
			classify({
				lyrics: "",
				genres: ["electronic", "house", "dance"],
				instrumentalness: 0.949,
			}),
		).toBe("instrumental");
	});

	it("instrumentalness exactly 0.9 → instrumental (boundary inclusive)", () => {
		expect(
			classify({
				lyrics: "",
				instrumentalness: 0.9,
			}),
		).toBe("instrumental");
	});

	it("instrumentalness 0.955 via audioFeatures → instrumental (Goldmund)", () => {
		expect(
			classify({
				lyrics: "",
				audioFeatures: { instrumentalness: 0.955 } as never,
			}),
		).toBe("instrumental");
	});

	it("instrumentalness 0.884 does NOT trigger step 4 (Patrick Holland Closer)", () => {
		// Below 0.9: no vote
		expect(
			classify({
				lyrics: "",
				genres: ["house", "electronic"],
				instrumentalness: 0.884,
			}),
		).toBe("unknown");
	});

	it("mid instrumentalness 0.70 does not imply instrumental", () => {
		expect(
			classify({
				lyrics: "",
				instrumentalness: 0.7,
			}),
		).toBe("unknown");
	});

	it("low instrumentalness 0.01 does not imply lyrical", () => {
		// Saib — low instrumentalness, but no genres either → unknown via step 5
		expect(
			classify({
				lyrics: "",
				genres: [],
				instrumentalness: 0.01,
			}),
		).toBe("unknown");
	});
});

// ─── Step 5: unknown ─────────────────────────────────────────────────────────

describe("Step 5 — unknown (Laurence Guy Saw You...)", () => {
	it("no lyrics, null instrumentalness, deep house genre → unknown", () => {
		// Laurence Guy: no genres that match, null instrumentalness, no LRCLIB record
		expect(
			classify({
				lyrics: "",
				genres: ["deep house"],
				instrumentalness: undefined,
			}),
		).toBe("unknown");
	});

	it("no signal at all → unknown", () => {
		expect(
			classify({
				lyrics: "",
				genres: [],
				instrumentalness: undefined,
			}),
		).toBe("unknown");
	});
});

// ─── Remix / Hamayoun Angar: lyrical or unknown, NEVER confident-instrumental ─

describe("Remix/Hamayoun Angar — vocal (Dari) track is never confident-instrumental", () => {
	it("with Dari lyrics above word floor → lyrical", () => {
		// instrumentalness near 0, but has real lyrics
		const dariLyrics = "کلمه ".repeat(60);
		expect(
			classify({
				lyrics: dariLyrics,
				instrumentalness: 0.001,
				genres: [],
			}),
		).toBe("lyrical");
	});

	it("no lyrics, no genres, near-zero instrumentalness → unknown, not instrumental", () => {
		// Worst case: nothing to go on except near-zero instrumentalness (which gets
		// no vote). The correct result is unknown, never confident-instrumental.
		expect(
			classify({
				lyrics: "",
				genres: [],
				instrumentalness: 0.001,
			}),
		).not.toBe("instrumental");

		expect(
			classify({
				lyrics: "",
				genres: [],
				instrumentalness: 0.001,
			}),
		).toBe("unknown");
	});
});

// ─── Precedence ordering ─────────────────────────────────────────────────────

describe("Precedence ordering — lower steps cannot override higher steps", () => {
	it("step 1 wins over step 4: LRCLIB instrumental overrides high instrumentalness reading", () => {
		expect(
			classify({
				fetchOutcome: { kind: "instrumental", source: "lrclib" },
				lyrics: "",
				instrumentalness: 0.99,
			}),
		).toBe("instrumental");
	});

	it("step 2 wins over step 3: lyrics present overrides genre keyword", () => {
		// A song we hold real lyrics for must go lyrical even if genre says instrumental
		expect(
			classify({
				lyrics: "word ".repeat(60),
				genres: ["ambient"],
				instrumentalness: 0.3,
			}),
		).toBe("lyrical");
	});

	it("step 2 wins over step 4: lyrics present overrides instrumentalness ≥ 0.9", () => {
		expect(
			classify({
				lyrics: "word ".repeat(60),
				instrumentalness: 0.95,
			}),
		).toBe("lyrical");
	});

	it("step 3 wins over step 4: genre keyword is checked before instrumentalness", () => {
		// Both would give instrumental, but the ordering is genre → instrumentalness
		expect(
			classify({
				lyrics: "",
				genres: ["ambient"],
				instrumentalness: 0.95,
			}),
		).toBe("instrumental");
	});
});
