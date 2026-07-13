/**
 * The seed carried across the entrance (/playlists/new) → studio
 * (/playlists/new/studio) navigation, via router history STATE — never the URL.
 *
 * The entrance owns no draft state: IdeasBoard hands back a ResolvedIdeaVM (or null for
 * "own words" / "from scratch") plus the typed intent. Those are internal
 * starting values (a name, some genres, a pinned artist), not addressable state,
 * so they travel in history state and the studio URL stays clean. The seed is
 * ephemeral, exactly like the draft it initializes: a refresh clears both, just
 * as the pre-split single screen did — landing cold on /playlists/new/studio
 * simply opens a from-scratch draft.
 */

import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import type { ResolvedIdeaVM } from "./ideaTypes";
import type { CreatePlaylistDraftInit } from "./useCreatePlaylistDraft";

/** The starting values the studio opens with; every field optional (from-scratch = {}). */
export interface StudioSeed {
	/** Idea label → the studio's initial playlist name. */
	name?: string;
	/** Typed vibe; only ever set when the intent gate allows it. */
	intent?: string;
	genrePills?: string[];
	matchFilters?: PlaylistMatchFiltersV1;
	/** Artist idea pin — seeds the "Around" selection with one enabled artist. */
	pinArtist?: string;
	/** Land with the artist search focused (the seed card's "+" affordance). */
	focusArtistSearch?: boolean;
}

// Carry the seed in typed history state rather than search params. Augmenting
// HistoryState is what makes navigate({ state }) and location.state.studioSeed
// type-safe across the entrance and the studio route.
declare module "@tanstack/react-router" {
	interface HistoryState {
		studioSeed?: StudioSeed;
	}
}

/**
 * Collapse the entrance's (idea, intentText) into the studio seed. Intent is
 * assumed already gated by the caller (the entrance only lets an eligible
 * account type it).
 */
export function buildStudioSeed(
	idea: ResolvedIdeaVM | null,
	intentText: string,
): StudioSeed {
	return {
		name: idea?.label,
		intent: intentText || undefined,
		genrePills:
			idea && idea.genrePills.length > 0 ? idea.genrePills : undefined,
		matchFilters: idea?.matchFilters,
		pinArtist: idea?.pinArtist,
		focusArtistSearch: idea?.focusArtistSearch || undefined,
	};
}

/**
 * Seed the live draft from the studio seed. Intent is re-gated here so a stale
 * or hand-poked history state can't slip a premium intent past an ineligible
 * account — dropped exactly as the original single-screen handleSeed did.
 */
export function studioSeedToDraftInit(
	seed: StudioSeed,
	isIntentEligible: boolean,
): CreatePlaylistDraftInit {
	return {
		intent: isIntentEligible ? seed.intent : undefined,
		genrePills: seed.genrePills,
		matchFilters: seed.matchFilters,
		artists: seed.pinArtist ? [seed.pinArtist] : undefined,
	};
}
