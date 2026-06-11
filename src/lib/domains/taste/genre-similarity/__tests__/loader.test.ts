/**
 * Genre similarity loader tests.
 *
 * Verifies the artifact covers all whitelist genres and that similarity
 * values honour the directed contract of the genresgraph-compiled table.
 */

import { describe, expect, it } from "vitest";
import {
	canonicalizeGenre,
	GENRE_LIST,
} from "@/lib/integrations/lastfm/whitelist";
import { genreNeighbors, genreSimilarity } from "../loader";
import rawTable from "../table.json";

// ── Coverage ──────────────────────────────────────────────────────────────────

// The 4 isolated genres (no edges in the graph) are intentionally absent as
// table keys — the compiler only emits rows for genres with neighbors.
const DOCUMENTED_ISOLATED = new Set([
	"christmas",
	"crossover",
	"mashup",
	"vocal",
]);

describe("table coverage", () => {
	const canonicalGenres = [...new Set(GENRE_LIST.map(canonicalizeGenre))];

	it("every canonical whitelist genre has a table entry OR is a documented isolated genre", () => {
		const tableKeys = new Set(Object.keys(rawTable));
		const missing = canonicalGenres.filter(
			(g) => g !== "_meta" && !tableKeys.has(g) && !DOCUMENTED_ISOLATED.has(g),
		);
		expect(missing).toHaveLength(0);
	});

	it("genreSimilarity returns 1 for self-comparison on every whitelist genre", () => {
		for (const g of canonicalGenres) {
			expect(genreSimilarity(g, g)).toBe(1);
		}
	});
});

// ── Self-similarity ───────────────────────────────────────────────────────────

describe("genreSimilarity — self", () => {
	it("identical canonical inputs → 1", () => {
		expect(genreSimilarity("rock", "rock")).toBe(1);
		expect(genreSimilarity("hip-hop", "hip-hop")).toBe(1);
		expect(genreSimilarity("black metal", "black metal")).toBe(1);
	});

	it("variant inputs that canonicalize identically → 1", () => {
		// "hip hop" canonicalizes to "hip-hop"
		expect(genreSimilarity("hip hop", "hip-hop")).toBe(1);
		// "rnb" and "r&b" both canonicalize to "rnb"
		expect(genreSimilarity("r&b", "rnb")).toBe(1);
		// "drum n bass" canonicalizes to "drum and bass"
		expect(genreSimilarity("drum n bass", "drum and bass")).toBe(1);
	});
});

// ── Semantic spot-checks ──────────────────────────────────────────────────────

describe("genreSimilarity — semantic bands", () => {
	it("hip-hop ↔ rnb: HIGH (> 0.4)", () => {
		const s = genreSimilarity("hip-hop", "rnb");
		expect(s).toBeGreaterThan(0.4);
	});

	it("hip-hop ↔ black metal: ~0 (< 0.1)", () => {
		const s = genreSimilarity("hip-hop", "black metal");
		expect(s).toBeLessThan(0.1);
	});

	it("rock ↔ post-rock: PARTIAL (> 0 and < 1)", () => {
		const s = genreSimilarity("rock", "post-rock");
		expect(s).toBeGreaterThan(0);
		expect(s).toBeLessThan(1);
	});
});

// ── Directed contract ─────────────────────────────────────────────────────────

describe("genreSimilarity — directed contract", () => {
	it("rock→post-rock is 0.6 (parent-to-child edge)", () => {
		// The playlist's genre is the authoritative perspective for scoring;
		// rock as playlist genre gives full parent→child credit for post-rock songs.
		expect(genreSimilarity("rock", "post-rock")).toBeCloseTo(0.6, 5);
	});

	it("post-rock→rock is 0.45 (child-to-parent edge, lower than parent→child)", () => {
		// A post-rock playlist matching rock songs gets less credit than the reverse,
		// encoding the asymmetry that subgenres don't fully represent the parent.
		expect(genreSimilarity("post-rock", "rock")).toBeCloseTo(0.45, 5);
	});
});

// ── Unknown genres ────────────────────────────────────────────────────────────

describe("genreSimilarity — unknown inputs", () => {
	it("unknown genre pair returns 0", () => {
		expect(genreSimilarity("definitely-not-a-genre-xyz", "also-fake")).toBe(0);
	});

	it("unknown genre vs known genre returns 0", () => {
		expect(genreSimilarity("definitely-not-a-genre-xyz", "rock")).toBe(0);
	});
});

// ── genreNeighbors ────────────────────────────────────────────────────────────

describe("genreNeighbors", () => {
	it("returns an object (may be empty) for any whitelist genre", () => {
		const canonicalGenres = [...new Set(GENRE_LIST.map(canonicalizeGenre))];
		for (const g of canonicalGenres) {
			expect(typeof genreNeighbors(g)).toBe("object");
		}
	});

	it("matched genres have at least one neighbor with sim >= 0.3", () => {
		// rock has neighbors in the curated graph — all stored values must be >= floor
		const neighbors = genreNeighbors("rock");
		const sims = Object.values(neighbors);
		expect(sims.length).toBeGreaterThan(0);
		expect(sims.every((s) => s >= 0.3)).toBe(true);
	});

	it("all stored similarity values are within [0.3, 0.6] (compiled range)", () => {
		// The genresgraph compiler enforces floor=0.3, cap=0.6; verify the artifact
		// matches so a bad sync doesn't silently introduce out-of-range values.
		const canonicalGenres = [...new Set(GENRE_LIST.map(canonicalizeGenre))];
		for (const g of canonicalGenres) {
			for (const v of Object.values(genreNeighbors(g))) {
				expect(v).toBeGreaterThanOrEqual(0.3);
				expect(v).toBeLessThanOrEqual(0.6);
			}
		}
	});
});

// ── Golden-pairs gate ─────────────────────────────────────────────────────────
//
// This gate exists because the previous (EveryNoise) artifact regressed silently
// — acceptance only sampled lucky pairs. An incorrect sync now fails here
// immediately before reaching CI or production.

describe("golden pairs — positives (must return > 0.4)", () => {
	const positivePairs: [string, string][] = [
		["rock", "hard rock"],
		["rock", "classic rock"],
		["rock", "indie rock"],
		["rock", "post-rock"],
		["pop", "indie pop"],
		["pop", "synth-pop"], // variant input — canonicalizes to synthpop
		["metal", "heavy metal"],
		["hip-hop", "trap"],
		["hip-hop", "rap"],
		["hip-hop", "r&b"], // variant of rnb
		["jazz", "smooth jazz"],
		["house", "deep house"],
		["house", "techno"],
		["folk", "indie folk"],
		["country", "folk"],
	];

	for (const [a, b] of positivePairs) {
		it(`${a} → ${b} is > 0.4`, () => {
			expect(genreSimilarity(a, b)).toBeGreaterThan(0.4);
		});
	}
});

describe("golden pairs — negatives (must return exactly 0)", () => {
	const zeroPairs: [string, string][] = [
		["rock", "martial industrial"],
		["rock", "power electronics"],
		["rock", "lo-fi"],
		["pop", "chiptune"],
		["hip-hop", "teen pop"],
		["hip-hop", "latin"],
		["hip-hop", "black metal"],
		["metal", "rnb"],
		["classical", "trap"],
		["country", "techno"],
		["jazz", "black metal"],
	];

	for (const [a, b] of zeroPairs) {
		it(`${a} ↔ ${b} is 0 in both directions`, () => {
			expect(genreSimilarity(a, b)).toBe(0);
			expect(genreSimilarity(b, a)).toBe(0);
		});
	}
});
