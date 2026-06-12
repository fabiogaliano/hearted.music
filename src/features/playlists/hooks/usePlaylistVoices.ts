import { useMemo } from "react";
import type { Playlist } from "@/lib/domains/library/playlists/queries";

export type PlaylistVoiceState =
	| "cold-start"
	| "vibe-leads"
	| "balanced"
	| "songs-lead";

export interface PlaylistVoiceWeights {
	songs: number;
	vibe: number;
	state: PlaylistVoiceState;
	hasDescription: boolean;
	songCount: number;
}

interface PlaylistVoicesInput {
	songCount: number;
	hasDescription: boolean;
}

// These mirror the matcher constants in
// src/lib/domains/taste/playlist-profiling/calculations.ts.
// They live inline here (rather than imported) so the client bundle never
// crosses the domain/service boundary into server-only Supabase code paths.
// A sync test in __tests__/usePlaylistVoices.test.ts asserts these stay in
// step with the live computeIntentWeight over a sample grid.
const INTENT_BASE_WEIGHT = 0.35;
const INTENT_DESC_BOOST = 1.5;
const INTENT_MATURITY_THRESHOLD = 30;
const INTENT_FLOOR_WITH_DESC = 0.3;
const INTENT_FLOOR_NAME_ONLY = 0.15;

// Cold-start handling mirrors the matcher: blendEmbeddings short-circuits
// to the intent vector when the song centroid is empty, so the effective
// vibe weight is 1.0 even though the formula would return ~0.525.
// Thresholds below are calibrated to the live curve — max post-cold vibe is
// ~0.51 (with description), so cutoffs sit inside that band rather than the
// wider 0–1 range the formula's name might suggest.
const VIBE_LEADS_MIN = 0.45;
const BALANCED_MIN = 0.25;

function intentWeight(songCount: number, hasDescription: boolean): number {
	const descBoost = hasDescription ? INTENT_DESC_BOOST : 1.0;
	const decay = Math.max(0, 1.0 - songCount / INTENT_MATURITY_THRESHOLD);
	const weight = INTENT_BASE_WEIGHT * descBoost * decay;
	const floor = hasDescription
		? INTENT_FLOOR_WITH_DESC
		: INTENT_FLOOR_NAME_ONLY;
	return Math.max(floor, Math.min(1.0, weight));
}

function classifyState(songCount: number, vibe: number): PlaylistVoiceState {
	if (songCount === 0) return "cold-start";
	if (vibe >= VIBE_LEADS_MIN) return "vibe-leads";
	if (vibe >= BALANCED_MIN) return "balanced";
	return "songs-lead";
}

export function computePlaylistVoices(
	input: PlaylistVoicesInput,
): PlaylistVoiceWeights {
	const { songCount, hasDescription } = input;

	if (songCount === 0) {
		return {
			songs: 0,
			vibe: 1,
			state: "cold-start",
			hasDescription,
			songCount,
		};
	}

	const vibe = intentWeight(songCount, hasDescription);
	const songs = 1 - vibe;

	return {
		songs,
		vibe,
		state: classifyState(songCount, vibe),
		hasDescription,
		songCount,
	};
}

export function usePlaylistVoices(
	playlistOrInput: Playlist | PlaylistVoicesInput,
): PlaylistVoiceWeights {
	const songCount =
		"song_count" in playlistOrInput
			? (playlistOrInput.song_count ?? 0)
			: playlistOrInput.songCount;
	const hasDescription =
		"match_intent" in playlistOrInput
			? Boolean(playlistOrInput.match_intent?.trim())
			: playlistOrInput.hasDescription;

	return useMemo(
		() => computePlaylistVoices({ songCount, hasDescription }),
		[songCount, hasDescription],
	);
}
