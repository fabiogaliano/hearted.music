/**
 * Ladle stub for @/lib/server/playlist-draft.functions.
 *
 * The real module uses createServerFn which pulls drizzle/postgres/supabase
 * into the graph via authMiddleware. None of those can run in the browser.
 * All four exported server functions become no-ops / controllable promises so
 * stories can drive any fixture state they need without a real server.
 */

import type { SongVM } from "@/lib/domains/playlists/types";

// ── Types (re-exported verbatim) ──────────────────────────────────────────────

export interface PreviewPlaylistDraftResult {
	preview: SongVM[];
	suggestions: SongVM[];
	totalEligible: number;
	intentApplied: boolean;
}

export interface PersistNewPlaylistConfigResult {
	trackUris: string[];
}

// ── Controllable fixture state ────────────────────────────────────────────────

let _previewResult: PreviewPlaylistDraftResult = {
	preview: [],
	suggestions: [],
	totalEligible: 0,
	intentApplied: false,
};

export function setPreviewResult(result: PreviewPlaylistDraftResult) {
	_previewResult = result;
}

// ── Stub callables ────────────────────────────────────────────────────────────

export const previewPlaylistDraft = (_opts: unknown) =>
	Promise.resolve(_previewResult);

export const resolveSpotifyUserId = () =>
	Promise.resolve({ spotifyUserId: null as string | null });

export const persistNewPlaylistConfig = (_opts: unknown) =>
	Promise.resolve({ trackUris: [] } satisfies PersistNewPlaylistConfigResult);

export const recordPlaylistMatchDecisions = (_opts: unknown) =>
	Promise.resolve();
