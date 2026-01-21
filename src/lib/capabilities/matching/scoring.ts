/**
 * Scoring utilities for playlist matching.
 *
 * Implements the multi-factor scoring algorithms from the old matching service.
 * All scores are normalized to 0-1 range.
 */

import type { AudioFeatureWeights, MatchingAudioFeatures } from "./types";

// ============================================================================
// Mood Transitions
// ============================================================================

/**
 * Good mood transitions for flow scoring.
 * Maps source mood to array of compatible target moods.
 */
export const GOOD_MOOD_TRANSITIONS: Record<string, string[]> = {
	happy: ["euphoric", "nostalgic", "empowered", "relaxed", "cheerful"],
	sad: ["melancholic", "nostalgic", "anxious", "contemplative", "bittersweet"],
	angry: ["empowered", "anxious", "aggressive", "intense", "defiant"],
	anxious: ["relaxed", "sad", "contemplative", "hopeful", "reflective"],
	nostalgic: ["happy", "sad", "melancholic", "contemplative", "wistful"],
	melancholic: ["sad", "nostalgic", "contemplative", "peaceful", "reflective"],
	euphoric: ["happy", "empowered", "energetic", "celebratory", "joyful"],
	relaxed: ["peaceful", "contemplative", "happy", "nostalgic", "calm"],
	empowered: ["happy", "euphoric", "angry", "confident", "triumphant"],
	contemplative: [
		"relaxed",
		"nostalgic",
		"melancholic",
		"peaceful",
		"thoughtful",
	],
	peaceful: ["relaxed", "contemplative", "happy", "calm", "serene"],
	energetic: ["euphoric", "empowered", "happy", "intense", "uplifting"],
};

/**
 * Related moods (looser match than good transitions).
 */
export const RELATED_MOODS: Record<string, string[]> = {
	happy: ["joyful", "cheerful", "upbeat", "positive", "bright"],
	sad: ["sorrowful", "mournful", "heartbroken", "gloomy", "downbeat"],
	angry: ["furious", "frustrated", "aggressive", "intense", "fierce"],
	anxious: ["nervous", "tense", "worried", "uneasy", "restless"],
	nostalgic: ["reminiscent", "sentimental", "wistful", "longing", "yearning"],
	melancholic: ["somber", "pensive", "mournful", "wistful", "bittersweet"],
	euphoric: ["ecstatic", "elated", "blissful", "exuberant", "jubilant"],
	relaxed: ["calm", "tranquil", "serene", "mellow", "laid-back"],
	empowered: ["confident", "strong", "triumphant", "bold", "assertive"],
};

// ============================================================================
// Audio Feature Scoring
// ============================================================================

/**
 * Compare audio features between a song and playlist centroid.
 * Uses weighted absolute difference.
 *
 * @returns Score 0-1 (1 = perfect match)
 */
export function computeAudioFeatureScore(
	songFeatures: MatchingAudioFeatures,
	playlistCentroid: Record<string, number>,
	weights: AudioFeatureWeights,
): number {
	let score = 0;
	let totalWeight = 0;

	const features: (keyof MatchingAudioFeatures)[] = [
		"energy",
		"valence",
		"danceability",
		"acousticness",
		"instrumentalness",
		"speechiness",
		"liveness",
		"tempo",
		"loudness",
	];

	for (const feature of features) {
		const songValue = songFeatures[feature];
		const centroidValue = playlistCentroid[feature];
		const weight = weights[feature];

		if (
			songValue !== undefined &&
			centroidValue !== undefined &&
			weight !== undefined
		) {
			let diff: number;

			if (feature === "tempo") {
				// Normalize tempo difference (max considered difference = 100 BPM)
				diff = Math.abs(songValue - centroidValue) / 100;
			} else if (feature === "loudness") {
				// Normalize loudness difference (range -60 to 0, so max diff ~60)
				diff = Math.abs(songValue - centroidValue) / 60;
			} else {
				// Other features are already 0-1
				diff = Math.abs(songValue - centroidValue);
			}

			// Score = 1 - diff (clamped)
			score += weight * Math.max(0, 1 - diff);
			totalWeight += weight;
		}
	}

	if (totalWeight === 0) return 0;

	return score / totalWeight;
}

// ============================================================================
// Context Scoring
// ============================================================================

/**
 * Calculate listening context alignment between song and playlist.
 *
 * @returns Score 0-1
 */
export function computeContextScore(
	songContexts: Record<string, number>,
	profileContexts: Record<string, number>,
): number {
	if (
		Object.keys(songContexts).length === 0 ||
		Object.keys(profileContexts).length === 0
	) {
		return 0;
	}

	let score = 0;
	let factors = 0;

	for (const [context, profileScore] of Object.entries(profileContexts)) {
		const songScore = songContexts[context];
		if (songScore !== undefined && songScore > 0) {
			// Take minimum of song and profile scores (conservative matching)
			score += Math.min(profileScore, songScore);
			factors++;
		}
	}

	if (factors === 0) return 0;

	// Normalize by number of matching contexts
	return Math.min(1, score / factors);
}

// ============================================================================
// Thematic Scoring
// ============================================================================

/**
 * Calculate thematic alignment between song themes and playlist themes.
 * Uses simple string matching (can be enhanced with embeddings later).
 *
 * @returns Score 0-1
 */
export function computeThematicScore(
	songThemes: string[],
	profileThemes: string[],
	themeWeight: number = 0.25,
): number {
	if (songThemes.length === 0 || profileThemes.length === 0) {
		return 0;
	}

	// Normalize themes for comparison
	const normalizedSongThemes = songThemes.map((t) => t.toLowerCase().trim());
	const normalizedProfileThemes = profileThemes.map((t) =>
		t.toLowerCase().trim(),
	);

	// Count matches
	let matchCount = 0;
	for (const songTheme of normalizedSongThemes) {
		for (const profileTheme of normalizedProfileThemes) {
			if (
				songTheme === profileTheme ||
				songTheme.includes(profileTheme) ||
				profileTheme.includes(songTheme)
			) {
				matchCount++;
				break; // Count each song theme only once
			}
		}
	}

	// Score = matchCount * themeWeight, capped at 1
	return Math.min(1, matchCount * themeWeight);
}

// ============================================================================
// Flow Scoring
// ============================================================================

/**
 * Score mood transition quality.
 *
 * @returns Score 0-1
 */
export function scoreMoodTransition(sourceMood: string, targetMood: string): number {
	const normalizedSource = sourceMood.toLowerCase().trim();
	const normalizedTarget = targetMood.toLowerCase().trim();

	// Same mood = perfect
	if (normalizedSource === normalizedTarget) {
		return 1.0;
	}

	// Good transition
	const goodTransitions = GOOD_MOOD_TRANSITIONS[normalizedSource];
	if (goodTransitions?.includes(normalizedTarget)) {
		return 0.8;
	}

	// Related moods
	const related = RELATED_MOODS[normalizedSource];
	if (related?.includes(normalizedTarget)) {
		return 0.6;
	}

	// Different mood
	return 0.3;
}

/**
 * Calculate flow compatibility with recent playlist songs.
 * Considers mood transitions, energy flow, and valence flow.
 *
 * @param songMood - Candidate song's dominant mood
 * @param songEnergy - Candidate song's energy (0-1)
 * @param songValence - Candidate song's valence (0-1)
 * @param recentSongs - Recent songs in playlist (last 3-5)
 * @returns Score 0-1
 */
export function computeFlowScore(
	songMood: string | null,
	songEnergy: number | null,
	songValence: number | null,
	recentSongs: ReadonlyArray<{
		readonly dominantMood: string | null;
		readonly energy: number;
		readonly valence: number;
	}>,
): number {
	if (recentSongs.length === 0) {
		return 0.5; // Neutral if no recent songs
	}

	// Take last 3 songs max
	const songsToCompare = recentSongs.slice(-3);
	const scores: number[] = [];

	for (const recentSong of songsToCompare) {
		let combinedScore = 0;
		let weightSum = 0;

		// Mood transition (50% weight)
		if (songMood && recentSong.dominantMood) {
			const moodScore = scoreMoodTransition(recentSong.dominantMood, songMood);
			combinedScore += moodScore * 0.5;
			weightSum += 0.5;
		}

		// Energy flow (30% weight)
		if (songEnergy !== null) {
			const energyDiff = Math.abs(recentSong.energy - songEnergy);
			const energyScore = 1 - energyDiff * 0.5; // Gentle penalty
			combinedScore += Math.max(0, energyScore) * 0.3;
			weightSum += 0.3;
		}

		// Valence flow (20% weight)
		if (songValence !== null) {
			const valenceDiff = Math.abs(recentSong.valence - songValence);
			const valenceScore = 1 - valenceDiff * 0.3; // Even gentler
			combinedScore += Math.max(0, valenceScore) * 0.2;
			weightSum += 0.2;
		}

		if (weightSum > 0) {
			scores.push(combinedScore / weightSum);
		}
	}

	if (scores.length === 0) {
		return 0.5; // Neutral fallback
	}

	// Average flow score across recent songs
	return scores.reduce((a, b) => a + b, 0) / scores.length;
}
