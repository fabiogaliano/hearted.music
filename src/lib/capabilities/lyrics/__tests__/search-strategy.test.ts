/**
 * Tests for the Genius search strategy module.
 *
 * Tests query normalization, result scoring, and match finding
 * using the v0-proven constants (0.6 threshold, 55/45 weights).
 */

import { describe, expect, it } from "vitest";
import type { ResponseHitsResult } from "../types/genius.types";
import {
	extractCollaborators,
	findBestMatch,
	generateQueryVariants,
	scoreResult,
} from "../utils/search-strategy";

// ============================================================================
// Query Variant Generation
// ============================================================================

describe("generateQueryVariants", () => {
	it("generates clean title first (removes parentheticals)", () => {
		const variants = generateQueryVariants(
			"Sam Fender",
			"Seventeen Going Under (Live)",
		);

		expect(variants[0]).toBe("Sam Fender Seventeen Going Under");
	});

	it("generates clean title removing dash suffixes", () => {
		const variants = generateQueryVariants(
			"The Weeknd",
			"Blinding Lights - 128 BPM Mix",
		);

		expect(variants[0]).toBe("The Weeknd Blinding Lights");
	});

	it("includes original query as fallback", () => {
		const variants = generateQueryVariants("BTS", "Dynamite");

		expect(variants).toContain("BTS Dynamite");
	});

	it("handles feat. patterns", () => {
		const variants = generateQueryVariants(
			"Kendrick Lamar",
			"All The Stars (feat. SZA)",
		);

		expect(variants).toContain("Kendrick Lamar All The Stars");
		expect(variants).toContain("Kendrick Lamar SZA All The Stars");
	});

	it("handles (with X) patterns", () => {
		const variants = generateQueryVariants(
			"Sam Fender",
			"Spit Of You (with Olivia Dean)",
		);

		expect(variants).toContain("Sam Fender Spit Of You");
		expect(variants).toContain("Sam Fender and Olivia Dean Spit Of You");
	});

	it("removes multiple parenthetical sections", () => {
		const variants = generateQueryVariants(
			"Daft Punk",
			"Get Lucky (feat. Pharrell Williams) [Radio Edit]",
		);

		expect(variants[0]).toBe("Daft Punk Get Lucky");
	});
});

// ============================================================================
// Collaborator Extraction
// ============================================================================

describe("extractCollaborators", () => {
	it("extracts (with X) collaborators", () => {
		const result = extractCollaborators("Spit Of You (with Olivia Dean)");

		expect(result).toEqual({
			artists: ["Olivia Dean"],
			type: "with",
		});
	});

	it("extracts (feat. X) collaborators", () => {
		const result = extractCollaborators("All The Stars (feat. SZA)");

		expect(result).toEqual({
			artists: ["SZA"],
			type: "feat",
		});
	});

	it("extracts multiple collaborators", () => {
		const result = extractCollaborators("Song (feat. Artist A & Artist B)");

		expect(result).toEqual({
			artists: ["Artist A", "Artist B"],
			type: "feat",
		});
	});

	it("returns null for no collaborators", () => {
		const result = extractCollaborators("Normal Song Title");

		expect(result).toBeNull();
	});

	it("handles [with X] bracket notation", () => {
		const result = extractCollaborators("Song [with Someone]");

		expect(result).toEqual({
			artists: ["Someone"],
			type: "with",
		});
	});
});

// ============================================================================
// Result Scoring
// ============================================================================

describe("scoreResult", () => {
	const createMockResult = (
		title: string,
		artistName: string,
	): ResponseHitsResult =>
		({
			id: 123,
			url: "https://genius.com/test",
			title,
			primary_artist: { name: artistName },
			primary_artists: [{ name: artistName }],
			featured_artists: [],
		}) as unknown as ResponseHitsResult;

	it("scores exact match close to 1.0", () => {
		const result = createMockResult("Blinding Lights", "The Weeknd");
		const score = scoreResult(result, "The Weeknd", "Blinding Lights");

		expect(score.score).toBeGreaterThan(0.95);
	});

	it("uses 55/45 title/artist weighting", () => {
		// Perfect title, wrong artist
		const titleMatch = createMockResult("Blinding Lights", "Wrong Artist");
		const titleScore = scoreResult(titleMatch, "The Weeknd", "Blinding Lights");

		// Title match should have high title score but low artist score
		expect(titleScore.titleScore).toBeGreaterThan(0.9);
		expect(titleScore.artistScore).toBeLessThan(0.5);
		// Overall score should reflect the 55/45 weighting
		expect(titleScore.score).toBeGreaterThan(0.5);
	});

	it("applies collaborator bonus when matched", () => {
		const result = {
			...createMockResult("Spit Of You", "Sam Fender"),
			primary_artists: [{ name: "Sam Fender" }, { name: "Olivia Dean" }],
		} as unknown as ResponseHitsResult;

		const score = scoreResult(
			result,
			"Sam Fender",
			"Spit Of You (with Olivia Dean)",
		);

		expect(score.collaboratorBonus).toBe(0.1);
	});

	it("applies collaborator penalty when expected but not found", () => {
		const result = createMockResult("Spit Of You", "Sam Fender");
		const score = scoreResult(
			result,
			"Sam Fender",
			"Spit Of You (with Olivia Dean)",
		);

		expect(score.collaboratorBonus).toBe(-0.15);
	});
});

// ============================================================================
// Best Match Finding
// ============================================================================

describe("findBestMatch", () => {
	const createMockResult = (
		id: number,
		title: string,
		artistName: string,
	): ResponseHitsResult =>
		({
			id,
			url: `https://genius.com/${id}`,
			title,
			primary_artist: { name: artistName },
			primary_artists: [{ name: artistName }],
			featured_artists: [],
		}) as unknown as ResponseHitsResult;

	it("returns best match above 0.6 threshold", () => {
		const results = [
			createMockResult(1, "Blinding Lights", "The Weeknd"),
			createMockResult(2, "Wrong Song", "Wrong Artist"),
		];

		const match = findBestMatch(
			results,
			"The Weeknd",
			"Blinding Lights",
			"query",
		);

		expect(match).not.toBeNull();
		expect(match?.result.id).toBe(1);
		expect(match?.score).toBeGreaterThan(0.6);
	});

	it("returns null when no match meets threshold", () => {
		const results = [
			createMockResult(1, "Completely Different", "Unknown Artist"),
			createMockResult(2, "Also Wrong", "Another Artist"),
		];

		const match = findBestMatch(
			results,
			"The Weeknd",
			"Blinding Lights",
			"query",
		);

		expect(match).toBeNull();
	});

	it("selects best match from multiple candidates", () => {
		const results = [
			createMockResult(1, "Blinding Lights (Radio Edit)", "The Weeknd"),
			createMockResult(2, "Blinding Lights", "The Weeknd"),
			createMockResult(3, "Blinding", "Weeknd"),
		];

		const match = findBestMatch(
			results,
			"The Weeknd",
			"Blinding Lights",
			"query",
		);

		// Both id=1 and id=2 are valid matches - normalization removes "(Radio Edit)"
		// so both score equally. The algorithm returns the first high-scoring match.
		expect(match).not.toBeNull();
		expect([1, 2]).toContain(match?.result.id);
		expect(match?.score).toBeGreaterThan(0.95);
	});

	it("returns null for empty results", () => {
		const match = findBestMatch([], "Artist", "Song", "query");
		expect(match).toBeNull();
	});
});
