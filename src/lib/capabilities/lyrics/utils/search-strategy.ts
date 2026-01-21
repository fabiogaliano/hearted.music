/**
 * Smart search strategy for finding songs on Genius.
 *
 * Implements:
 * 1. Multi-result scanning - check top N results, not just first
 * 2. Combined scoring - weight both title and artist similarity
 * 3. Progressive simplification - try simpler queries as fallback
 *
 * Scoring constants (preserved from v0):
 * - MIN_COMBINED_SCORE: 0.6 (minimum to accept a match)
 * - Title weight: 0.55, Artist weight: 0.45
 * - Collaborator bonus: +0.1 / penalty: -0.15
 */

import type { ResponseHitsResult } from "../types/genius.types";
import { calculateSimilarity } from "./string-similarity";

/**
 * Information about collaborating artists extracted from a song title
 */
export interface CollaboratorInfo {
	artists: string[];
	type: "with" | "feat";
}

/**
 * Extract collaborating artists from a song title
 *
 * Handles patterns like:
 * - "(with X)" / "[with X]" → collaboration, Genius uses primary_artists
 * - "(feat. X)" / "(ft. X)" / "(featuring X)" → featured, Genius uses featured_artists
 * - Multiple artists: "X & Y", "X, Y & Z"
 */
export function extractCollaborators(title: string): CollaboratorInfo | null {
	// Check for "(with X)" or "[with X]" - these are collaborations
	const withMatch = title.match(/[\(\[]with\s+([^\)\]]+)[\)\]]/i);
	if (withMatch) {
		return {
			artists: withMatch[1]
				.split(/\s*[,&]\s*/)
				.map((a) => a.trim())
				.filter(Boolean),
			type: "with",
		};
	}

	// Check for "(feat. X)" patterns - these are features
	const featMatch = title.match(
		/[\(\[](?:feat\.?|ft\.?|featuring)\s*([^\)\]]+)[\)\]]/i,
	);
	if (featMatch) {
		return {
			artists: featMatch[1]
				.split(/\s*[,&]\s*/)
				.map((a) => a.trim())
				.filter(Boolean),
			type: "feat",
		};
	}

	return null;
}

export interface SearchCandidate {
	id: number;
	url: string;
	title: string;
	artistName: string;
	score: number;
	titleScore: number;
	artistScore: number;
	collaboratorBonus: number;
}

export interface SearchMatch {
	result: ResponseHitsResult;
	score: number;
	titleScore: number;
	artistScore: number;
	queryUsed: string;
}

// Minimum combined score to accept a match
const MIN_COMBINED_SCORE = 0.6;
// How many results to scan from each search
const MAX_RESULTS_TO_SCAN = 10;

/**
 * Generate search queries optimized for Genius API
 *
 * Based on testing with real data:
 * - Clean query (artist + title without parentheticals) works 83% at position 1
 * - Full title with "(feat. X)" or "(with X)" almost never works
 * - Including featured artist in search often hurts results
 *
 * Order is optimized for fastest match:
 * 1. Clean title (highest success rate)
 * 2. Original query (works for some edge cases)
 * 3. Featured artist variants (last resort)
 */
export function generateQueryVariants(artist: string, title: string): string[] {
	const queries: string[] = [];
	const dashPattern = /\s*[-–—]\s*.+$/;

	// Helper to add unique queries
	const addQuery = (query: string) => {
		if (!queries.includes(query)) {
			queries.push(query);
		}
	};

	// 1. CLEAN TITLE FIRST - 83% success rate at position 1
	// Remove parentheticals AND dash suffixes
	const cleanTitle = title
		.replace(/\s*[\(\[][^\)\]]+[\)\]]\s*/g, "") // Remove (content) and [content]
		.replace(dashPattern, "") // Remove " - suffix"
		.trim();

	if (cleanTitle && cleanTitle !== title) {
		addQuery(`${artist} ${cleanTitle}`);
	}

	// 2. Remove just parentheticals (if different from clean)
	const withoutParens = title.replace(/\s*[\(\[][^\)\]]+[\)\]]\s*/g, "").trim();
	if (withoutParens !== cleanTitle) {
		addQuery(`${artist} ${withoutParens}`);
	}

	// 3. Remove just dash suffix (if different)
	if (dashPattern.test(title)) {
		const withoutDash = title.replace(dashPattern, "").trim();
		addQuery(`${artist} ${withoutDash}`);
	}

	// 4. Original query - sometimes works (e.g., Korean songs)
	addQuery(`${artist} ${title}`);

	// 5. Featured artist variants - last resort, often hurts more than helps
	// Only try if we have a featured artist pattern
	const withMatch = title.match(/[\(\[]with\s+([^\)\]]+)[\)\]]/i);
	if (withMatch) {
		const featuredArtist = withMatch[1].split(/\s*[,&]\s*/)[0].trim();
		addQuery(`${artist} and ${featuredArtist} ${cleanTitle}`);
	}

	const featMatch = title.match(
		/[\(\[](?:feat\.?|ft\.?|featuring)\s*([^\)\]]+)[\)\]]/i,
	);
	if (featMatch) {
		const featuredArtist = featMatch[1].split(/\s*[,&]\s*/)[0].trim();
		addQuery(`${artist} ${featuredArtist} ${cleanTitle}`);
	}

	return queries;
}

/**
 * Score a search result against the target artist and title
 * Returns a combined score that weights both matches
 */
export function scoreResult(
	result: ResponseHitsResult,
	targetArtist: string,
	targetTitle: string,
): SearchCandidate {
	// Normalize the target title for comparison (remove suffixes, parens, etc.)
	const normalizedTargetTitle = normalizeForComparison(targetTitle);

	const titleScore = Math.max(
		calculateSimilarity(result.title, targetTitle),
		calculateSimilarity(result.title, normalizedTargetTitle),
	);

	const artistScore = calculateSimilarity(
		result.primary_artist.name,
		targetArtist,
	);

	// Check for collaborators in the target title and match against API result
	const collaboratorBonus = calculateCollaboratorBonus(result, targetTitle);

	// Combined score: weight title slightly higher since artist can vary
	// (e.g., "Sam Fender" vs "Sam Fender & Olivia Dean")
	const baseScore = titleScore * 0.55 + artistScore * 0.45;
	const score = Math.min(1, Math.max(0, baseScore + collaboratorBonus));

	return {
		id: result.id,
		url: result.url,
		title: result.title,
		artistName: result.primary_artist.name,
		score,
		titleScore,
		artistScore,
		collaboratorBonus,
	};
}

/**
 * Calculate a bonus/penalty based on collaborator matching
 *
 * If the target title has "(with X)" or "(feat. X)", we check if the
 * corresponding artist appears in the Genius result:
 * - "(with X)" → X should be in primary_artists (Genius treats as collaboration)
 * - "(feat. X)" → X should be in featured_artists
 *
 * Returns:
 * - +0.1 if collaborator found in correct array (prefer this version)
 * - -0.15 if collaborator expected but NOT found (penalize wrong version)
 * - 0 if no collaborator in title
 */
function calculateCollaboratorBonus(
	result: ResponseHitsResult,
	targetTitle: string,
): number {
	const collaborators = extractCollaborators(targetTitle);

	if (!collaborators) {
		return 0;
	}

	// Get the correct array based on pattern type
	const checkArray =
		collaborators.type === "with"
			? result.primary_artists?.map((a) => a.name) || []
			: result.featured_artists?.map((a) => a.name) || [];

	// Check if any expected collaborator is in the result
	const hasMatch = collaborators.artists.some((expected) =>
		checkArray.some(
			(actual) =>
				calculateSimilarity(expected.toLowerCase(), actual.toLowerCase()) > 0.8,
		),
	);

	return hasMatch ? 0.1 : -0.15;
}

/**
 * Normalize a title for comparison purposes
 * Strips common suffixes but keeps the core song name
 */
function normalizeForComparison(title: string): string {
	return (
		title
			// Remove ALL content after dash (mix variants, remasters, etc.)
			// This handles: "Song - 128 BPM mix", "Song - Remastered", "Song - Radio Edit"
			.replace(/\s*[-–—]\s*.+$/i, "")
			// Remove parenthetical and bracket content
			.replace(/\s*[\(\[][^\)\]]*[\)\]]\s*/g, " ")
			// Clean up whitespace
			.replace(/\s+/g, " ")
			.trim()
	);
}

/**
 * Find the best matching result from a list of search results
 */
export function findBestMatch(
	results: ResponseHitsResult[],
	targetArtist: string,
	targetTitle: string,
	queryUsed: string,
): SearchMatch | null {
	if (!results || results.length === 0) {
		return null;
	}

	// Score all results (up to MAX_RESULTS_TO_SCAN)
	const candidates = results
		.slice(0, MAX_RESULTS_TO_SCAN)
		.map((result) => scoreResult(result, targetArtist, targetTitle));

	// Sort by combined score descending
	candidates.sort((a, b) => b.score - a.score);

	const best = candidates[0];

	// Check if best match meets minimum threshold
	if (best.score >= MIN_COMBINED_SCORE) {
		const matchingResult = results.find((r) => r.id === best.id)!;
		return {
			result: matchingResult,
			score: best.score,
			titleScore: best.titleScore,
			artistScore: best.artistScore,
			queryUsed,
		};
	}

	return null;
}

/**
 * Debug helper: log top candidates with their scores (condensed format)
 */
export function debugCandidates(
	results: ResponseHitsResult[],
	targetArtist: string,
	targetTitle: string,
): void {
	const candidates = results
		.slice(0, MAX_RESULTS_TO_SCAN)
		.map((result) => scoreResult(result, targetArtist, targetTitle));

	candidates.sort((a, b) => b.score - a.score);

	// Only log top 3 candidates in a compact format
	const top3 = candidates.slice(0, 3).map((c, i) => ({
		rank: i + 1,
		match: `${c.artistName} - ${c.title}`,
		score: `${(c.score * 100).toFixed(0)}%`,
	}));

	console.log(
		`[LyricsSearch] Target: ${targetArtist} - ${targetTitle}, Candidates:`,
		top3,
	);
}
