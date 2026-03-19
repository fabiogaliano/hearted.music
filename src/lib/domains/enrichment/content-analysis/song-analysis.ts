import { Result } from "better-result";
import { z } from "zod";
import type { SongAnalysis } from "@/lib/domains/enrichment/content-analysis/queries";
import * as songAnalysis from "@/lib/domains/enrichment/content-analysis/queries";
import type { AudioFeature } from "@/lib/domains/enrichment/audio-features/queries";
import type { DbError } from "@/lib/shared/errors/database";
import type { AnalysisFailedError } from "@/lib/shared/errors/domain/analysis";
import type { LlmError } from "@/lib/shared/errors/external/llm";
import type { LlmService } from "@/lib/integrations/llm/service";
import { getLyricsFormatLegend } from "../lyrics/utils/lyrics-formatter";

const ThemeSchema = z.object({ name: z.string(), description: z.string() });
const JourneyPointSchema = z.object({
	section: z.string(),
	mood: z.string(),
	description: z.string(),
});
const KeyLineSchema = z.object({ line: z.string(), insight: z.string() });

export const SongAnalysisLyricalSchema = z.object({
	headline: z.string(),
	compound_mood: z.string(),
	mood_description: z.string(),
	interpretation: z.string(),
	themes: z.array(ThemeSchema),
	journey: z.array(JourneyPointSchema),
	key_lines: z.array(KeyLineSchema),
	sonic_texture: z.string(),
});
export type SongAnalysisLyrical = z.infer<typeof SongAnalysisLyricalSchema>;

export const SongAnalysisInstrumentalSchema = z.object({
	headline: z.string(),
	compound_mood: z.string(),
	mood_description: z.string(),
	sonic_texture: z.string(),
});
export type SongAnalysisInstrumental = z.infer<
	typeof SongAnalysisInstrumentalSchema
>;

export type SongAnalysisResult = SongAnalysisLyrical | SongAnalysisInstrumental;

export function isLyricalAnalysis(
	result: SongAnalysisResult,
): result is SongAnalysisLyrical {
	return "interpretation" in result;
}

export interface AnalyzeSongInput {
	songId: string;
	artist: string;
	title: string;
	lyrics?: string | null;
	audioFeatures?: AudioFeature | null;
	genres?: string[];
	instrumentalness?: number;
}

export interface AnalyzeSongResult {
	songId: string;
	analysis: SongAnalysis;
	tokensUsed?: number;
	cached: boolean;
}

export interface BatchAnalysisResult {
	succeeded: AnalyzeSongResult[];
	failed: Array<{
		songId: string;
		artist: string;
		title: string;
		error: string;
	}>;
}

type SongAnalysisServiceError = DbError | LlmError | AnalysisFailedError;

const LYRICAL_ANALYSIS_PROMPT = `You're writing song analysis for Hearted, a music app. Users can already see the title and artist. Your job is to tell them what they haven't noticed — the stuff underneath.

Here's what you're working with:

{artist} — "{title}"
Genres: {genres}

Audio features:
{audio_features}

Lyrics:
{lyrics}

---

Return structured JSON with these fields.

**compound_mood**: Two words. [Modifier] + [Core Emotion]. Name what makes the feeling specific, not generic. "Anxious Nostalgia", "Tender Desperation", "Sardonic Clarity." When lyrics and production pull in different directions, the compound holds both.

**mood_description**: One or two sentences. Present tense. Put the listener inside the feeling — what does it feel like to hear this right now? "Restless energy wrapped in synth-pop shimmer. The dancefloor is spinning but she's somewhere else entirely."

**interpretation**: What is this really about? One paragraph. Start directly with the insight — never open with "This is about", "This is an anthem of", "This is a..." or any framing. Just land the point.
Do this: "The agonizing realization that love isn't always enough."
Do this: "Craving connection even when lost in the haze."
Not this: "This is about the agonizing realization..."
Not this: "This is an anthem of self-affirmation..."
If the production and lyrics tell different stories, say so plainly.

**themes**: 2-4 themes. Each has a lowercase \`name\` specific to this song and a one-sentence \`description\`. Be honest and specific — name what's actually happening, even when it's uncomfortable. Good: "fragile masculinity", "self-inflicted wounds", "performative wokeness", "fear of time." Bad: "existentialism", "love", "identity."

**journey**: 4-6 entries tracing the song from opening to outro. Each has a \`section\`, a \`mood\` (2-3 words), and a \`description\`.

This is the most important field. The journey should read like a story — each entry picks up where the last one left off. Reading the descriptions in sequence should feel like watching the song unfold in real time. If the chorus explodes after a quiet verse, the reader feels that contrast. If the outro fades, close the story.

Example of a connected journey:
- "A lone voice wondering what's real. Drifting between worlds, caught in slow motion."
- "The crime revealed. Quiet, personal, like whispering a secret that changes everything."
- "A madcap swirl of characters and voices. Pleading, mocking, anything to escape the inevitable."
- "Pure fury. A final stand against the forces closing in."
- "Emptying out. Accepting that nothing matters after all, as the sound fades to silence."

Not this (disconnected):
- "The intro is atmospheric."
- "The verse has a melancholic quality."
- "The chorus is uplifting."
- "The bridge provides contrast."

**key_lines**: 3-5 lyrics that hit hardest. Exact \`line\` from the lyrics, plus an \`insight\` that names why it lands — not restating the lyric, and not using the "isn't X, it's Y" formula.
Do this: "It feels so scary getting old" → "Losing the version of yourself that only exists tonight."
Do this: "Nobody pray for me" → "Isolation is the starting point, a plea unanswered."
Not this: "The real madness isn't aging, it's the loss of control." (negative parallelism — classic AI pattern)

**sonic_texture**: What this physically sounds like. Instruments, production, the feel. "Layered synths, pulsing bass, ethereal vocals floating over mechanical rhythm."

**headline**: One or two sentences. The emotional essence — what this song is really about, not what it sounds like. Paint the feeling, not the genre.
Do this: "A fever dream of regret, bargaining with fate in operatic swells."
Do this: "A skeletal relationship, clinging to the last vestiges of hope, even as it crumbles into dust."
Not this: "Opera and hard rock collide in a theatrical battle." (describes the sound, not the story)
Not this: "Raw vulnerability stripped bare." (abstract label, not a specific image)

---

Rules:

Never reference the song title, artist name, or say "this song" / "the track" / "the listener." Just state the insight.

Never name the subject — no "the speaker", "the narrator", "the singer." Use fragments instead. "Pleading for a love that's already gone." Not: "The speaker pleads for a love that's already gone."

Write like a person talking to a friend about a song they love. Use words you'd actually say out loud. If you wouldn't text it to someone, don't write it.

Never use clinical or academic vocabulary:
- No: "disorientation", "juxtaposition", "dichotomy", "visceral", "catharsis", "existential"
- No: "sensory overload", "emotional landscape", "sonic architecture", "lyrical framework"
- No: "explores themes of", "commentary on", "serves as", "underscores"
- Instead of "emotional disorientation" → "not knowing what to feel"
- Instead of "sensory overload" → "too much happening at once"
- Instead of "juxtaposition of X and Y" → just describe the contrast plainly

Never use these AI writing patterns:
- "isn't X, it's Y" / "not X, but Y" / "not just X; it's Y" / "doesn't just X; they Y" — this is the single most common AI tell. Just state what it IS.
- "This is about..." / "This is an anthem of..." / "This is a reckoning with..." — never open any field this way
- "serves as a testament to" / "underscores" / "highlights the" (significance inflation)
- "showcasing" / "emphasizing" / "reflecting" / "symbolizing" (participial tacking)
- "perhaps" / "might be" / "seems to" / "could be interpreted as" (hedging)
- Listing three things for emphasis when two or one would do
- Using a different fancy synonym each sentence for the same thing

Present tense. Confident. Warm but not gushing. Vary your sentence lengths. Let audio features inform your descriptions without listing them.`;

const INSTRUMENTAL_ANALYSIS_PROMPT = `You're writing song analysis for Hearted, a music app. Users can already see the title and artist. Your job is to tell them what they haven't noticed — the stuff underneath.

This is an instrumental track (no lyrics or minimal vocals). Focus entirely on what the music itself communicates.

Here's what you're working with:

{artist} — "{title}"
Genres: {genres}

Audio features:
{audio_features}

---

Return structured JSON with these fields.

**compound_mood**: Two words. [Modifier] + [Core Emotion]. Name what makes the feeling specific, not generic. "Brooding Grandeur", "Floating Stillness", "Mechanical Urgency." The compound should capture what makes this piece's mood distinct from a thousand others in the same genre.

**mood_description**: One or two sentences. Present tense. Put the listener inside the feeling — what does it feel like to hear this right now? Ground it in the physical experience of listening.

**sonic_texture**: What this physically sounds like. Instruments, production techniques, the feel of the sound. This is the most important field for an instrumental — paint the full picture. "A bed of analog synths humming beneath brittle piano, kick drum pushing through like a heartbeat in a quiet room."

**headline**: One or two sentences. The emotional essence — what this music is really about, not what it sounds like. Paint the feeling, not the genre.
Do this: "Standing alone in a cathedral of sound, watching light move through stained glass."
Not this: "An ambient electronic piece with lush textures." (describes the sound, not the feeling)
Not this: "A sonic journey through space." (abstract, says nothing specific)

---

Rules:

Never reference the song title, artist name, or say "this song" / "the track" / "the listener." Just state the insight.

Write like a person talking to a friend about music they love. Use words you'd actually say out loud. If you wouldn't text it to someone, don't write it.

Never use clinical or academic vocabulary:
- No: "disorientation", "juxtaposition", "dichotomy", "visceral", "catharsis", "existential"
- No: "sensory overload", "emotional landscape", "sonic architecture"
- No: "explores themes of", "commentary on", "serves as", "underscores"
- Instead of "emotional disorientation" → "not knowing what to feel"
- Instead of "sensory overload" → "too much happening at once"
- Instead of "juxtaposition of X and Y" → just describe the contrast plainly

Never use these AI writing patterns:
- "isn't X, it's Y" / "not X, but Y" / "not just X; it's Y"
- "serves as a testament to" / "underscores" / "highlights the"
- "showcasing" / "emphasizing" / "reflecting" / "symbolizing"
- "perhaps" / "might be" / "seems to" / "could be interpreted as"
- Listing three things for emphasis when two or one would do

Present tense. Confident. Warm but not gushing. Vary your sentence lengths. Let audio features inform your descriptions without listing them.`;

const INSTRUMENTAL_WORD_THRESHOLD = 50;

export class SongAnalysisService {
	constructor(private readonly llm: LlmService) {}

	async analyzeSong(
		input: AnalyzeSongInput,
	): Promise<Result<AnalyzeSongResult, SongAnalysisServiceError>> {
		const { songId } = input;

		const existingResult = await songAnalysis.get(songId);
		if (Result.isError(existingResult)) {
			return Result.err(existingResult.error);
		}
		if (existingResult.value) {
			return Result.ok({
				songId,
				analysis: existingResult.value,
				cached: true,
			});
		}

		const isInstrumental = this.detectInstrumental(input);

		const prompt = isInstrumental
			? this.buildInstrumentalPrompt(input)
			: this.buildPrompt(input);

		const schema = isInstrumental
			? SongAnalysisInstrumentalSchema
			: SongAnalysisLyricalSchema;

		const llmResult = await this.llm.generateObject(prompt, schema);
		if (Result.isError(llmResult)) {
			return Result.err(llmResult.error);
		}

		const analysisData = this.buildAnalysisData(
			llmResult.value.output,
			input.audioFeatures,
		);

		const storeResult = await songAnalysis.insert({
			song_id: songId,
			analysis: analysisData as songAnalysis.InsertData["analysis"],
			model: llmResult.value.model,
			prompt_version: "2",
			tokens_used: llmResult.value.tokens?.total ?? null,
			cost_cents: null,
		});

		if (Result.isError(storeResult)) {
			return Result.err(storeResult.error);
		}

		return Result.ok({
			songId,
			analysis: storeResult.value,
			tokensUsed: llmResult.value.tokens?.total,
			cached: false,
		});
	}

	async analyzeBatch(
		inputs: AnalyzeSongInput[],
	): Promise<Result<BatchAnalysisResult, DbError>> {
		const succeeded: AnalyzeSongResult[] = [];
		const failed: Array<{
			songId: string;
			artist: string;
			title: string;
			error: string;
		}> = [];

		for (const input of inputs) {
			const result = await this.analyzeSong(input);

			if (Result.isOk(result)) {
				succeeded.push(result.value);
			} else {
				failed.push({
					songId: input.songId,
					artist: input.artist,
					title: input.title,
					error:
						result.error instanceof Error
							? result.error.message
							: String(result.error),
				});
			}
		}

		return Result.ok({ succeeded, failed });
	}

	private detectInstrumental(input: AnalyzeSongInput): boolean {
		if (!input.lyrics || input.lyrics.trim().length === 0) {
			return true;
		}

		const instrumentalness =
			input.instrumentalness ?? input.audioFeatures?.instrumentalness;
		if (instrumentalness != null && instrumentalness > 0.5) {
			return true;
		}

		const wordCount = input.lyrics.trim().split(/\s+/).length;
		if (wordCount < INSTRUMENTAL_WORD_THRESHOLD) {
			return true;
		}

		return false;
	}

	private buildPrompt(input: AnalyzeSongInput): string {
		const genres = this.formatGenres(input.genres);
		const lyricsWithLegend = `${getLyricsFormatLegend()}\n${input.lyrics}`;
		return LYRICAL_ANALYSIS_PROMPT.replace("{artist}", input.artist)
			.replace("{title}", input.title)
			.replace("{genres}", genres)
			.replace("{lyrics}", lyricsWithLegend)
			.replace(
				"{audio_features}",
				this.formatAudioFeatures(input.audioFeatures),
			);
	}

	private buildInstrumentalPrompt(input: AnalyzeSongInput): string {
		const genres = this.formatGenres(input.genres);
		return INSTRUMENTAL_ANALYSIS_PROMPT.replace("{artist}", input.artist)
			.replace("{title}", input.title)
			.replace("{genres}", genres)
			.replace(
				"{audio_features}",
				this.formatAudioFeatures(input.audioFeatures),
			);
	}

	private formatGenres(genres?: string[]): string {
		if (!genres || genres.length === 0) return "Unknown";
		return genres.join(", ");
	}

	private formatAudioFeatures(features?: AudioFeature | null): string {
		if (!features) {
			return "Audio features not available - analyze based on lyrics only";
		}

		return `Tempo: ${features.tempo ?? "unknown"} BPM
Energy: ${features.energy ?? "unknown"} (0.0 = low, 1.0 = high)
Valence: ${features.valence ?? "unknown"} (0.0 = sad/negative, 1.0 = happy/positive)
Danceability: ${features.danceability ?? "unknown"} (0.0 = not danceable, 1.0 = very danceable)
Acousticness: ${features.acousticness ?? "unknown"} (0.0 = not acoustic, 1.0 = acoustic)
Instrumentalness: ${features.instrumentalness ?? "unknown"} (0.0 = vocal, 1.0 = instrumental)
Liveness: ${features.liveness ?? "unknown"} (0.0 = studio, 1.0 = live performance)
Speechiness: ${features.speechiness ?? "unknown"} (0.0 = non-speech, 1.0 = speech-like)
Loudness: ${features.loudness ?? "unknown"} dB`;
	}

	private buildAnalysisData(
		llmOutput: SongAnalysisResult,
		audioFeatures?: AudioFeature | null,
	): Record<string, unknown> {
		const analysisData: Record<string, unknown> = { ...llmOutput };
		if (audioFeatures) {
			analysisData.audio_features = {
				tempo: audioFeatures.tempo,
				energy: audioFeatures.energy,
				valence: audioFeatures.valence,
				danceability: audioFeatures.danceability,
				acousticness: audioFeatures.acousticness,
				instrumentalness: audioFeatures.instrumentalness,
				liveness: audioFeatures.liveness,
				speechiness: audioFeatures.speechiness,
				loudness: audioFeatures.loudness,
			};
		}
		return analysisData;
	}
}
