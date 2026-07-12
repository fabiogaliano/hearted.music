/**
 * Ladle stub for @/lib/server/playlist-draft.functions.
 *
 * The real module uses createServerFn which pulls drizzle/postgres/supabase
 * into the graph via authMiddleware. None of those can run in the browser.
 * All four exported server functions become no-ops / controllable promises so
 * stories can drive any fixture state they need without a real server.
 */

// Type-only imports: erased before module resolution, so they can never pull
// the real module's server graph (drizzle/postgres/supabase via authMiddleware)
// into the Ladle bundle. `satisfies` below then keeps every constructed
// literal checked against the real result shape.
import type {
	PersistNewPlaylistConfigResult,
	PreviewPlaylistDraftResult,
	recordPlaylistMatchDecisions as recordPlaylistMatchDecisionsReal,
} from "@/lib/server/playlist-draft.functions";

// recordPlaylistMatchDecisions doesn't export a named result interface (its
// handler uses an inline return-type annotation), so its real shape is pulled
// through the function's own type instead of a named type import.
type RecordPlaylistMatchDecisionsResult = Awaited<
	ReturnType<typeof recordPlaylistMatchDecisionsReal>
>;

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
	Promise.resolve({
		trackUris: [],
		playlistId: "stub-playlist-id",
	} satisfies PersistNewPlaylistConfigResult);

export const recordPlaylistMatchDecisions = (_opts: unknown) =>
	Promise.resolve({
		recorded: 0,
	} satisfies RecordPlaylistMatchDecisionsResult);
