/**
 * Ladle stub for @/lib/extension/create-playlist-from-draft.
 *
 * The real orchestrator calls the extension (which can't run in a browser
 * without the real extension installed). The default stub below never resolves,
 * so a story's submit stays in its "submitting" state and the button is inert
 * in Ladle.
 */

import type { CreatePlaylistFromDraftInput } from "@/lib/extension/create-playlist-from-draft";

export type { CreatePlaylistFromDraftResult } from "@/lib/extension/create-playlist-from-draft";

// Default: never resolves so stories that hit submit just stay in "submitting"
// state, which is safe and clearly shows the loading affordance.
export const createPlaylistFromDraft = (_input: CreatePlaylistFromDraftInput) =>
	new Promise<never>(() => {});

// Same posture for the resume path — never resolves in Ladle.
export const resumePlaylistCreateFromDraft = (
	_input: CreatePlaylistFromDraftInput,
	_playlistUri: string,
	_spotifyId: string,
) => new Promise<never>(() => {});
