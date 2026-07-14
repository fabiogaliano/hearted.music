/**
 * Shared DTOs for Spotify sync workflows.
 *
 * The wire shapes are derived from the shared Zod schema
 * (shared/spotify-sync-payload-schema.ts) — the single source of truth for
 * what the extension uploads — instead of a hand-maintained copy.
 */

import type { Song } from "@/lib/domains/library/songs/queries";
import type {
	SpotifyPlaylistDTO,
	SpotifyTrackDTO,
} from "../../../../shared/spotify-sync-payload-schema";

export type { SpotifyPlaylistDTO, SpotifyTrackDTO };

/** Result of syncing liked songs */
export interface LikedSongsSyncResult {
	total: number;
	added: number;
	removed: number;
	newSongs: Song[];
}
