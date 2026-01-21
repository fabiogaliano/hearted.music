/**
 * Text extraction for embedding generation.
 *
 * Extracts structured text from songs and playlists
 * for vectorization. Combines metadata, analysis, and context.
 */

// ============================================================================
// Types
// ============================================================================

/** Structured text for vectorization */
export interface VectorizationText {
	/** Basic metadata (title, artist, genre) */
	readonly metadata: string;
	/** Analysis-derived text (themes, mood, meaning) */
	readonly analysis: string;
	/** Context text (listening situations, audience) */
	readonly context: string;
}

/** Song analysis shape (subset of full analysis) */
export interface SongAnalysisData {
	readonly themes?: Array<{ theme: string; confidence?: number }>;
	readonly interpretation?: string;
	readonly musical?: {
		readonly mood?: string;
		readonly style?: string;
		readonly intensity?: string | number;
	};
	readonly emotional?: {
		readonly dominant_mood?: string;
		readonly mood_progression?: string;
		readonly emotional_journey?: string;
	};
	readonly context?: {
		readonly listening_contexts?: Array<{
			context: string;
			score?: number;
		}>;
		readonly best_moments?: string[];
		readonly ideal_audience?: string;
	};
}

/** Playlist analysis shape */
export interface PlaylistAnalysisData {
	readonly core_themes?: string[];
	readonly mood?: {
		readonly primary?: string;
		readonly progression?: string;
	};
	readonly musical_identity?: {
		readonly style?: string;
		readonly energy_profile?: string;
	};
	readonly target_audience?: string;
	readonly listening_contexts?: string[];
}

// ============================================================================
// Song Extraction
// ============================================================================

/**
 * Extract vectorization text from song data.
 */
export function extractSongText(song: {
	name: string;
	artists: string[];
	album_name?: string | null;
	genres?: string[] | null;
	analysis?: SongAnalysisData | null;
}): VectorizationText {
	// Metadata
	const metadataParts: string[] = [];
	metadataParts.push(song.name);
	metadataParts.push(song.artists.join(", "));
	if (song.album_name) {
		metadataParts.push(song.album_name);
	}
	if (song.genres && song.genres.length > 0) {
		metadataParts.push(song.genres.join(", "));
	}

	// Analysis
	const analysisParts: string[] = [];
	if (song.analysis) {
		const a = song.analysis;

		// Themes (repeat high-confidence themes)
		if (a.themes) {
			const themeTexts = a.themes
				.filter((t) => t.theme)
				.map((t) => {
					const confidence = t.confidence ?? 0.5;
					// Repeat theme based on confidence for emphasis
					const repeats = confidence > 0.7 ? 2 : 1;
					return Array(repeats).fill(t.theme).join(" ");
				});
			if (themeTexts.length > 0) {
				analysisParts.push(themeTexts.join(", "));
			}
		}

		// Interpretation
		if (a.interpretation) {
			analysisParts.push(a.interpretation);
		}

		// Musical style and mood
		if (a.musical?.mood) {
			analysisParts.push(a.musical.mood);
		}
		if (a.musical?.style) {
			analysisParts.push(a.musical.style);
		}
		if (a.musical?.intensity) {
			analysisParts.push(intensityToText(a.musical.intensity));
		}

		// Emotional profile
		if (a.emotional?.dominant_mood) {
			analysisParts.push(a.emotional.dominant_mood);
		}
		if (a.emotional?.mood_progression) {
			analysisParts.push(a.emotional.mood_progression);
		}
	}

	// Context
	const contextParts: string[] = [];
	if (song.analysis?.context) {
		const ctx = song.analysis.context;

		// Top listening contexts (score > 0.4, max 5)
		if (ctx.listening_contexts) {
			const topContexts = getTopListeningContexts(ctx.listening_contexts, 5);
			if (topContexts.length > 0) {
				contextParts.push(topContexts.join(", "));
			}
		}

		// Best moments
		if (ctx.best_moments && ctx.best_moments.length > 0) {
			contextParts.push(ctx.best_moments.join(", "));
		}

		// Audience
		if (ctx.ideal_audience) {
			contextParts.push(ctx.ideal_audience);
		}
	}

	return {
		metadata: metadataParts.join(" | "),
		analysis: analysisParts.join(" | "),
		context: contextParts.join(" | "),
	};
}

/**
 * Extract from analysis-only (when full song unavailable).
 */
export function extractSongAnalysisOnly(
	analysis: SongAnalysisData,
): VectorizationText {
	return extractSongText({
		name: "",
		artists: [],
		analysis,
	});
}

// ============================================================================
// Playlist Extraction
// ============================================================================

/**
 * Extract vectorization text from playlist data.
 */
export function extractPlaylistText(playlist: {
	name: string;
	description?: string | null;
	analysis?: PlaylistAnalysisData | null;
}): VectorizationText {
	// Metadata
	const metadataParts: string[] = [];
	metadataParts.push(playlist.name);
	if (playlist.description) {
		metadataParts.push(playlist.description);
	}

	// Analysis
	const analysisParts: string[] = [];
	if (playlist.analysis) {
		const a = playlist.analysis;

		// Core themes
		if (a.core_themes && a.core_themes.length > 0) {
			analysisParts.push(a.core_themes.join(", "));
		}

		// Mood
		if (a.mood?.primary) {
			analysisParts.push(a.mood.primary);
		}
		if (a.mood?.progression) {
			analysisParts.push(a.mood.progression);
		}

		// Musical identity
		if (a.musical_identity?.style) {
			analysisParts.push(a.musical_identity.style);
		}
		if (a.musical_identity?.energy_profile) {
			analysisParts.push(a.musical_identity.energy_profile);
		}
	}

	// Context
	const contextParts: string[] = [];
	if (playlist.analysis) {
		const a = playlist.analysis;

		if (a.target_audience) {
			contextParts.push(a.target_audience);
		}
		if (a.listening_contexts && a.listening_contexts.length > 0) {
			contextParts.push(a.listening_contexts.join(", "));
		}
	}

	return {
		metadata: metadataParts.join(" | "),
		analysis: analysisParts.join(" | "),
		context: contextParts.join(" | "),
	};
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Combine vectorization text sections into single string.
 */
export function combineVectorizationText(text: VectorizationText): string {
	return [text.metadata, text.analysis, text.context]
		.filter((s) => s.length > 0)
		.join(" | ");
}

/**
 * Convert intensity value to descriptive text.
 */
export function intensityToText(intensity: string | number): string {
	if (typeof intensity === "string") {
		return intensity;
	}

	// Numeric 0-10 scale
	if (intensity <= 2) return "very calm";
	if (intensity <= 4) return "calm";
	if (intensity <= 6) return "moderate";
	if (intensity <= 8) return "energetic";
	return "very intense";
}

/**
 * Get top listening contexts by score.
 */
export function getTopListeningContexts(
	contexts: Array<{ context: string; score?: number }>,
	limit: number,
): string[] {
	return contexts
		.filter((c) => c.context && (c.score ?? 0.5) > 0.4)
		.sort((a, b) => (b.score ?? 0.5) - (a.score ?? 0.5))
		.slice(0, limit)
		.map((c) => c.context);
}
