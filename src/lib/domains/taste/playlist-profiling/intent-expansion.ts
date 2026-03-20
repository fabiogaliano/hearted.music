/**
 * Cold-start intent expansion via HyDE (Hypothetical Document Embeddings).
 *
 * When a playlist has 0 songs, the only signal is its name/description.
 * This module asks an LLM to imagine a prototypical song for the playlist,
 * producing a rich pseudo-document that bridges the modality gap between
 * short playlist names and long song analysis embeddings.
 */

import { Result } from "better-result";
import { z } from "zod";
import type { LlmService } from "@/lib/integrations/llm/service";
import type { LlmError } from "@/lib/shared/errors/external/llm";

const ThemeSchema = z.object({ name: z.string(), description: z.string() });

export const ColdStartProfileSchema = z.object({
	headline: z.string(),
	compound_mood: z.string(),
	mood_description: z.string(),
	interpretation: z.string(),
	themes: z.array(ThemeSchema),
	sonic_texture: z.string(),
	expected_genres: z.array(z.string()),
	audio_profile: z.object({
		energy: z.number().min(0).max(1),
		valence: z.number().min(0).max(1),
		danceability: z.number().min(0).max(1),
		acousticness: z.number().min(0).max(1),
		instrumentalness: z.number().min(0).max(1),
		speechiness: z.number().min(0).max(1),
		liveness: z.number().min(0).max(1),
		tempo: z.number().min(40).max(220),
		loudness: z.number().min(-60).max(0),
	}),
});

export type ColdStartProfile = z.infer<typeof ColdStartProfileSchema>;

/**
 * Expand a playlist name/description into a rich song-analysis-style profile.
 */
export async function expandPlaylistIntent(
	llm: LlmService,
	name: string,
	description?: string,
): Promise<Result<ColdStartProfile, LlmError>> {
	const descPart = description ? `\nDescription: "${description}"` : "";

	const prompt = `You are a music analyst. Given a playlist name (and optional description), imagine the PROTOTYPICAL song that belongs in this playlist. Describe it as if you were writing a song analysis.

Playlist: "${name}"${descPart}

Write in present tense, conversational tone. No academic vocabulary. Be specific to the musical style this playlist name evokes.

For audio_profile, estimate Spotify-style audio features:
- energy, valence, danceability, acousticness, instrumentalness, speechiness, liveness: 0.0-1.0
- tempo: BPM (40-220)
- loudness: dB (-60 to 0, typical pop is -5 to -8)

For expected_genres, list 3-8 Spotify genre tags that would appear on songs in this playlist.

For themes, provide 2-4 thematic elements specific to this playlist's vibe.`;

	const result = await llm.generateObject(prompt, ColdStartProfileSchema);
	if (Result.isError(result)) {
		return Result.err(result.error);
	}

	return Result.ok(result.value.output);
}

/**
 * Build embedding text from a cold-start profile.
 * Mirrors EmbeddingService.buildEmbeddingText() structure for consistent
 * embedding space representation.
 */
export function buildColdStartEmbeddingText(profile: ColdStartProfile): string {
	const parts: string[] = [];

	if (profile.headline) parts.push(profile.headline);
	if (profile.compound_mood) parts.push(profile.compound_mood);
	if (profile.mood_description) parts.push(profile.mood_description);
	if (profile.interpretation) parts.push(profile.interpretation);

	for (const theme of profile.themes) {
		parts.push(theme.name);
		if (theme.description) parts.push(theme.description);
	}

	if (profile.sonic_texture) parts.push(profile.sonic_texture);

	return parts.join(". ");
}
