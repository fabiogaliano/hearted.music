// The read shape is owned by the Zod schema (read-schema.ts) so the UI can't
// drift from what the prompt generates. SongDetail is UI-only and stays here.

import type { z } from "zod";
import type { SongDisplayState } from "@/lib/domains/billing/state";
import type {
	ReadArcBeat,
	ReadLineBeat,
	SongRead,
} from "@/lib/domains/enrichment/content-analysis/read-schema";
import type { SongAnalysisInstrumentalSchema } from "@/lib/domains/enrichment/content-analysis/song-analysis";
import type { ThemeColor } from "@/lib/theme/types";

export type { ReadArcBeat, ReadLineBeat, SongRead };
export type SongInstrumentalRead = z.infer<
	typeof SongAnalysisInstrumentalSchema
>;

export interface SongDetail {
	id: string;
	spotifyTrackId: string;
	title: string;
	artist: string;
	album: string;
	// Optional: live liked-song rows carry no release year (the page RPC doesn't
	// return one), so the prod adapter omits it and the Hero hides the year.
	year?: number;
	genres: string[];
	// Each metric is independently nullable, mirroring `track.audio_features`:
	// a song may have some features and not others (and many have none at all).
	// null means "absent" so the panel renders only the columns it has instead
	// of gating the whole bpm/energy/valence block on one of them.
	audioFeatures: {
		tempo: number | null;
		energy: number | null;
		valence: number | null;
	};
	theme: ThemeColor;
	albumArtUrl?: string;
	artistImageUrl?: string;
	// Explains *why* `read` is absent so the panel can pick the right empty state
	// (locked song vs. queued/failed) instead of a single generic message. Optional
	// because the gold fixtures in song-detail-data.ts always carry a read, where this
	// is never consulted; the live adapter always sets it. Defaults to "analyzed".
	displayState?: SongDisplayState;
	// Latest lyrics-fetch outcome for this song; null when no fetch attempt has been
	// recorded. Drives "No words yet" vs "Listening": a song with not_found and no
	// read is resolved-unknown (show the unavailable state), not in-flight.
	contentFetchStatus?: "lyrics" | "instrumental" | "not_found" | null;
	// Null when the row has no v17 read yet (locked, not-yet-analyzed, or a pre-v17
	// 8-field row). The panel still opens — it renders the hero + a minimal empty
	// state keyed off `displayState` — so every selected song gets a panel.
	read: SongRead | null;
	// Non-null only when the stored analysis parsed as an instrumental read
	// (headline / compound_mood / sonic_texture / mood_description). Mutually
	// exclusive with `read`: a lyrical row sets `read`, an instrumental row sets
	// `instrumentalRead`, an unresolved/pre-v17 row leaves both null.
	instrumentalRead: SongInstrumentalRead | null;
}

// The add-to-playlist matches the panel renders at the bottom of a read. The page
// resolves these (the suggestions query + the Spotify/server side-effects) and
// hands them in pre-resolved — mirroring LockedCta — so the surface stays pure and
// Ladle-renderable, touching no queries or billing.
export interface PlaylistSuggestionView {
	playlistId: string;
	name: string;
	// 0..1 match score, rendered as a rounded percentage.
	score: number;
}

export interface PlaylistsPanel {
	matches: PlaylistSuggestionView[];
	// Playlist IDs added this session — flips the row to its "Added" state.
	addedTo: string[];
	// A Spotify add failed for auth reasons; rows offer a reconnect link, not Add.
	reconnectNeeded: boolean;
	onAdd: (playlistId: string) => void;
}
