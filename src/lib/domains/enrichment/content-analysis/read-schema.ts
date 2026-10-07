/**
 * Zod schema for the redesigned analysis model. See
 * docs/analysis/hearted-read.md §0 for the full rationale.
 *
 * Cardinality: Zod is the permissive envelope, the prompt is the narrower
 * target. Floors are looser than the prompt so coherent output is never
 * rejected (master §5.2).
 */

import { z } from "zod";
import type { Json } from "@/lib/data/database.types";

const ReadArcBeatSchema = z.object({
	label: z.string(),
	// May repeat: monochrome songs have beats but a flat register (diagnostic).
	mood: z.string(),
	scene: z.string(),
});

// A pivotal lyric quote. The per-line `insight` gloss was removed: it largely
// restated what `take` and `arc` already say, concentrated the most voice-audit
// violations, and was never read by the matching layer. The quote itself is the
// curation signal. Kept as an object (not a bare string) so historical reads that
// still carry `insight` keep validating — Zod strips the unknown key.
const ReadLineBeatSchema = z.object({
	line: z.string(),
});

export const SongReadSchema = z.object({
	image: z.string(),
	// Free string: the three-form grammar lives in the prompt + jury, not a
	// brittle Zod regex (docs/analysis/lens-vocabulary.md §3).
	lens: z.string(),
	// Qualified emotion, not a paradox; the paradox is `contradiction`'s job.
	tension: z.string(),
	take: z.string(),
	// Required key, nullable value: forces explicit null over silent omission.
	contradiction: z.string().nullable(),
	arc: z.array(ReadArcBeatSchema).min(2).max(4),
	lines: z.array(ReadLineBeatSchema).min(1).max(5),
	// Required key, nullable value: texture is the one field grounded in sound,
	// not lyrics, so it's written only when audio features exist (genre sharpens
	// it) and null otherwise. The panel hides the block on null rather than let
	// the model hallucinate a sound from the words.
	texture: z.string().nullable(),
});
export type SongRead = z.infer<typeof SongReadSchema>;
export type ReadArcBeat = z.infer<typeof ReadArcBeatSchema>;
export type ReadLineBeat = z.infer<typeof ReadLineBeatSchema>;

// Instrumental rows carry this shape instead of a SongRead. Lives here, not in
// song-analysis.ts, because the client panel parses stored rows with it and
// song-analysis.ts drags prompts and DB queries into the browser bundle.
export const SongAnalysisInstrumentalSchema = z.object({
	headline: z.string(),
	compound_mood: z.string(),
	mood_description: z.string(),
	sonic_texture: z.string(),
});
export type SongAnalysisInstrumental = z.infer<
	typeof SongAnalysisInstrumentalSchema
>;

// song-analysis.ts stores the read FLAT with an extra `audio_features` key, so a
// stored blob is `{ ...SongRead | SongAnalysisInstrumental, audio_features? }`.
// Each metric decodes on its own: a malformed or missing feature must never cost
// the song its read.
const StoredAudioFeaturesSchema = z.object({
	tempo: z.number().nullable().catch(null),
	energy: z.number().nullable().catch(null),
	valence: z.number().nullable().catch(null),
});
export type StoredAudioFeatures = z.infer<typeof StoredAudioFeaturesSchema>;

const StoredEnvelopeSchema = z.object({
	audio_features: StoredAudioFeaturesSchema.nullable().catch(null),
});

/**
 * The one parse of a stored song analysis. The audio features live in the
 * blob's envelope and are kept whatever the read turns out to be, because the
 * panel falls back to them when the track row has none. `read` is null when
 * the blob matches neither shape (e.g. older generations).
 */
export type StoredRead =
	| { kind: "lyrical"; value: SongRead }
	| { kind: "instrumental"; value: SongAnalysisInstrumental };

export type StoredAnalysis = {
	audioFeatures: StoredAudioFeatures | null;
	read: StoredRead | null;
};

export function parseStoredAnalysis(raw: Json | null): StoredAnalysis {
	const envelope = StoredEnvelopeSchema.safeParse(raw);
	const audioFeatures = envelope.success ? envelope.data.audio_features : null;
	return { audioFeatures, read: parseStoredRead(raw) };
}

// Lyrical first: the panel has always preferred the lyrical read when a blob
// could satisfy both shapes.
function parseStoredRead(raw: Json | null): StoredRead | null {
	const lyrical = SongReadSchema.safeParse(raw);
	if (lyrical.success) {
		return { kind: "lyrical", value: lyrical.data };
	}
	const instrumental = SongAnalysisInstrumentalSchema.safeParse(raw);
	if (instrumental.success) {
		return { kind: "instrumental", value: instrumental.data };
	}
	return null;
}
