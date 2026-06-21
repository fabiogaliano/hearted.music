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
	SavePlaylistMatchConfigInput,
	SavePlaylistMatchConfigResult,
} from "@/lib/server/playlists.functions";

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

export async function getAccountTopGenres(): Promise<{ genres: string[] }> {
	return { genres: [...STATIC_TOP_GENRES] };
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
	return { matchIntent, genrePills, matchFilters };
}

// Legacy separate-save stubs kept so any remaining import paths don't break.
export type SaveGenrePillsBehavior = "success" | "fail";
let saveBehavior: SaveGenrePillsBehavior = "success";
export function setSaveGenrePillsBehavior(next: SaveGenrePillsBehavior) {
	saveBehavior = next;
}

export async function savePlaylistGenrePills(args: {
	data: { playlistId: string; genres: string[] };
}): Promise<{ success: boolean; pills: string[] }> {
	if (saveBehavior === "fail") {
		throw new Error("stubbed genre pills save failure");
	}
	return { success: true, pills: sanitizeGenrePills(args.data.genres) };
}

export type SaveMatchIntentBehavior = "success" | "fail" | "hang";
let saveMatchIntentBehavior: SaveMatchIntentBehavior = "success";
export function setSaveMatchIntentBehavior(next: SaveMatchIntentBehavior) {
	saveMatchIntentBehavior = next;
}

export async function savePlaylistMatchIntent(args: {
	data: { playlistId: string; matchIntent: string | null };
}): Promise<{ success: boolean; matchIntent: string | null }> {
	if (saveMatchIntentBehavior === "fail") {
		throw new Error("stubbed match intent save failure");
	}
	if (saveMatchIntentBehavior === "hang") {
		return new Promise<{ success: boolean; matchIntent: string | null }>(
			() => {},
		);
	}
	const trimmed = args.data.matchIntent?.trim() ?? "";
	return { success: true, matchIntent: trimmed.length > 0 ? trimmed : null };
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
