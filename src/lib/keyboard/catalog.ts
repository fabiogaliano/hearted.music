/**
 * Static catalog of all keyboard shortcuts in the app.
 * Used by ShortcutsHelpModal to display a full reference on any page.
 * Handlers live in the components — this is display-only.
 */
import type { ShortcutScope } from "./types";

export interface CatalogEntry {
	key: string;
	description: string;
	scope: ShortcutScope;
}

export const SHORTCUT_CATALOG: CatalogEntry[] = [
	// ── Liked Songs list ──────────────────────────────────────────────────────
	{ scope: "liked-list", key: "j", description: "Next song" },
	{ scope: "liked-list", key: "down", description: "Next song" },
	{ scope: "liked-list", key: "k", description: "Previous song" },
	{ scope: "liked-list", key: "up", description: "Previous song" },
	{ scope: "liked-list", key: "enter", description: "Open song detail" },
	{ scope: "liked-list", key: "mod+d", description: "Toggle dark mode" },

	// ── Liked Songs detail ────────────────────────────────────────────────────
	{ scope: "liked-detail", key: "j", description: "Next song" },
	{ scope: "liked-detail", key: "down", description: "Next song" },
	{ scope: "liked-detail", key: "k", description: "Previous song" },
	{ scope: "liked-detail", key: "up", description: "Previous song" },
	{ scope: "liked-detail", key: "enter", description: "Open analysis" },
	{ scope: "liked-detail", key: "escape", description: "Close detail" },

	// ── Liked Songs analysis ──────────────────────────────────────────────────
	{
		scope: "liked-detail-analysis",
		key: "escape",
		description: "Close analysis",
	},

	// ── Playlists list ────────────────────────────────────────────────────────
	{ scope: "playlists-list", key: "j", description: "Next playlist" },
	{ scope: "playlists-list", key: "down", description: "Next playlist" },
	{ scope: "playlists-list", key: "k", description: "Previous playlist" },
	{ scope: "playlists-list", key: "up", description: "Previous playlist" },
	{
		scope: "playlists-list",
		key: "enter",
		description: "Open playlist details",
	},

	// ── Playlists detail ──────────────────────────────────────────────────────
	{ scope: "playlists-detail", key: "escape", description: "Close detail" },
];
