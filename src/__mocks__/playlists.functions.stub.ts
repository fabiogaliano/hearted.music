/**
 * Ladle stub for @/lib/server/playlists.functions.
 *
 * The real module is a TanStack server-function file: its handlers pull drizzle /
 * postgres / supabase (node-only) into the module graph, which can't bundle for
 * the browser. The playlist detail stories reach this module transitively, so
 * aliasing the whole module here severs that chain.
 *
 * savePlaylistMatchConfig is controllable so stories can exercise success,
 * failure, and pending (hang) states.
 */

import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import { sanitizeGenrePills } from "@/lib/integrations/lastfm/whitelist";
import type {
	getAccountTopGenres as getAccountTopGenresReal,
	SavePlaylistMatchConfigInput,
	SavePlaylistMatchConfigResult,
} from "@/lib/server/playlists.functions";

// getAccountTopGenres has no named result interface (its handler uses an inline
// return-type annotation), so its real shape is pulled through the function's
// own type instead of a named type import.
type GetAccountTopGenresResult = Awaited<
	ReturnType<typeof getAccountTopGenresReal>
>;

const STATIC_TOP_GENRES = [
	"rock",
	"pop",
	"hip-hop",
	"electronic",
	"rnb",
	"jazz",
	"indie",
	"synthpop",
];

// "hang" never settles — drives the frozen "Saving…" story state.
export type SaveMatchConfigBehavior = "success" | "fail" | "hang";

let saveMatchConfigBehavior: SaveMatchConfigBehavior = "success";

export function setSaveMatchConfigBehavior(next: SaveMatchConfigBehavior) {
	saveMatchConfigBehavior = next;
}

export async function getAccountTopGenres(): Promise<GetAccountTopGenresResult> {
	return { genres: [...STATIC_TOP_GENRES] } satisfies GetAccountTopGenresResult;
}

export async function savePlaylistMatchConfig(args: {
	data: SavePlaylistMatchConfigInput;
}): Promise<SavePlaylistMatchConfigResult> {
	if (saveMatchConfigBehavior === "fail") {
		throw new Error("stubbed match config save failure");
	}
	if (saveMatchConfigBehavior === "hang") {
		return new Promise<SavePlaylistMatchConfigResult>(() => {});
	}
	// Mirror server normalization: trim intent, sanitize genres, pass filters through.
	const trimmed = args.data.matchIntent?.trim() ?? "";
	const matchIntent = trimmed.length > 0 ? trimmed : null;
	const genrePills = sanitizeGenrePills(args.data.genrePills);
	const matchFilters: PlaylistMatchFiltersV1 = args.data.matchFilters;
	return {
		matchIntent,
		genrePills,
		matchFilters,
	} satisfies SavePlaylistMatchConfigResult;
}

export async function getPlaylistManagementData(): Promise<never> {
	throw new Error("getPlaylistManagementData is not available in Ladle");
}

export async function getPlaylistTracksPage(): Promise<never> {
	throw new Error("getPlaylistTracksPage is not available in Ladle");
}

export async function getPlaylistMatchFilterOptions(): Promise<never> {
	throw new Error("getPlaylistMatchFilterOptions is not available in Ladle");
}

// Seed-stage stories seed the taste-profile query cache directly, so this is
// only here to satisfy the import — it must never actually run in Ladle.
export async function getTasteProfile(): Promise<never> {
	throw new Error("getTasteProfile is not available in Ladle");
}

// Studio artist selection: search finds nothing and resolution yields empty
// pools, so stories exercise the panel chrome without a library behind it.
export async function searchLikedArtists(_args: {
	data: { query: string };
}): Promise<{ artists: { name: string; count: number }[] }> {
	return { artists: [] };
}

export async function resolveLikedArtistSongs(_args: {
	data: { artists: string[]; matchFilters: unknown };
}): Promise<{ artists: { name: string; songIds: string[] }[] }> {
	return { artists: [] };
}
