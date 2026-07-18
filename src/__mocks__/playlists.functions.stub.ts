/**
 * Ladle stub for @/lib/server/playlists.functions.
 *
 * The real module is a TanStack server-function file: its handlers pull drizzle /
 * postgres / supabase (node-only) into the module graph, which can't bundle for
 * the browser. The playlist detail stories reach this module transitively, so
 * aliasing the whole module here severs that chain.
 *
 * savePlaylistMatchConfig is controllable so stories can exercise success,
 * failure, and pending (hang) states. The legacy separate-save stubs remain so
 * any older story paths that still import them don't break.
 */

import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import { sanitizeGenrePills } from "@/lib/integrations/lastfm/whitelist";
import type {
	getAccountTopGenres as getAccountTopGenresReal,
	SavePlaylistMatchConfigInput,
	SavePlaylistMatchConfigResult,
	savePlaylistGenrePills as savePlaylistGenrePillsReal,
	savePlaylistMatchIntent as savePlaylistMatchIntentReal,
} from "@/lib/server/playlists.functions";

// getAccountTopGenres/savePlaylistGenrePills/savePlaylistMatchIntent don't
// export named result interfaces (their handlers use inline return-type
// annotations), so their real shape is pulled through the function's own type
// instead of a named type import.
type GetAccountTopGenresResult = Awaited<
	ReturnType<typeof getAccountTopGenresReal>
>;
type SavePlaylistGenrePillsResult = Awaited<
	ReturnType<typeof savePlaylistGenrePillsReal>
>;
type SavePlaylistMatchIntentResult = Awaited<
	ReturnType<typeof savePlaylistMatchIntentReal>
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

// Legacy separate-save stubs kept so any remaining import paths don't break.
export type SaveGenrePillsBehavior = "success" | "fail";
let saveBehavior: SaveGenrePillsBehavior = "success";
export function setSaveGenrePillsBehavior(next: SaveGenrePillsBehavior) {
	saveBehavior = next;
}

export async function savePlaylistGenrePills(args: {
	data: { playlistId: string; genres: string[] };
}): Promise<SavePlaylistGenrePillsResult> {
	if (saveBehavior === "fail") {
		throw new Error("stubbed genre pills save failure");
	}
	return {
		success: true,
		pills: sanitizeGenrePills(args.data.genres),
	} satisfies SavePlaylistGenrePillsResult;
}

export type SaveMatchIntentBehavior = "success" | "fail" | "hang";
let saveMatchIntentBehavior: SaveMatchIntentBehavior = "success";
export function setSaveMatchIntentBehavior(next: SaveMatchIntentBehavior) {
	saveMatchIntentBehavior = next;
}

export async function savePlaylistMatchIntent(args: {
	data: { playlistId: string; matchIntent: string | null };
}): Promise<SavePlaylistMatchIntentResult> {
	if (saveMatchIntentBehavior === "fail") {
		throw new Error("stubbed match intent save failure");
	}
	if (saveMatchIntentBehavior === "hang") {
		return new Promise<SavePlaylistMatchIntentResult>(() => {});
	}
	const trimmed = args.data.matchIntent?.trim() ?? "";
	return {
		success: true,
		matchIntent: trimmed.length > 0 ? trimmed : null,
	} satisfies SavePlaylistMatchIntentResult;
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
