/**
 * Ladle stub for @/lib/server/playlists.functions.
 *
 * The real module is a TanStack server-function file: its handlers pull drizzle /
 * postgres / supabase (node-only) into the module graph, which can't bundle for
 * the browser. The OnboardingDescriptionDialog story reaches this module
 * transitively (genre quick-picks query + the pills autosave hook), so aliasing
 * the whole module here severs that chain.
 *
 * Only the exports the Ladle graph references are provided. savePlaylistGenrePills
 * is controllable so a story can exercise the autosave error toast; the others
 * are import-satisfying no-ops that the rendered components never call.
 */

import { sanitizeGenrePills } from "@/lib/integrations/lastfm/whitelist";

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

export type SaveGenrePillsBehavior = "success" | "fail";

let saveBehavior: SaveGenrePillsBehavior = "success";

export function setSaveGenrePillsBehavior(next: SaveGenrePillsBehavior) {
	saveBehavior = next;
}

// "hang" never settles — drives the dialog's frozen "Saving…" story.
export type SaveMatchIntentBehavior = "success" | "fail" | "hang";

let saveMatchIntentBehavior: SaveMatchIntentBehavior = "success";

export function setSaveMatchIntentBehavior(next: SaveMatchIntentBehavior) {
	saveMatchIntentBehavior = next;
}

export async function getAccountTopGenres(): Promise<{ genres: string[] }> {
	return { genres: [...STATIC_TOP_GENRES] };
}

export async function savePlaylistGenrePills(args: {
	data: { playlistId: string; genres: string[] };
}): Promise<{ success: boolean; pills: string[] }> {
	if (saveBehavior === "fail") {
		throw new Error("stubbed genre pills save failure");
	}
	// Mirror the server's sanitize so the UI adopts a realistic response.
	return { success: true, pills: sanitizeGenrePills(args.data.genres) };
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
	// Mirror the server's trim/empty→null so the UI adopts a realistic response.
	const trimmed = args.data.matchIntent?.trim() ?? "";
	return { success: true, matchIntent: trimmed.length > 0 ? trimmed : null };
}

export async function getPlaylistManagementData(): Promise<never> {
	throw new Error("getPlaylistManagementData is not available in Ladle");
}

export async function getPlaylistTracksPage(): Promise<never> {
	throw new Error("getPlaylistTracksPage is not available in Ladle");
}
