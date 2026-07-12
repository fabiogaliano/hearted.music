/**
 * Shared interaction harness for the whole-screen prototypes: a draft you can
 * actually curate — add pulls a song out of the tray, remove sends it back to
 * the tray's tail (fake backfill) — so every direction is judged with the
 * real add/remove loop running, not a static list. Fixture-backed; no
 * queries, no engine.
 */

import { useState } from "react";
import { SONG_FIXTURES } from "@/lib/domains/playlists/fixtures";
import type { SongVM } from "@/lib/domains/playlists/types";

export interface ProtoDraft {
	preview: SongVM[];
	suggestions: SongVM[];
	addSong: (id: string) => void;
	removeSong: (id: string) => void;
	refreshSuggestions: () => void;
	totalMinutes: number;
}

export function useProtoDraft(): ProtoDraft {
	const [preview, setPreview] = useState<SongVM[]>(() =>
		SONG_FIXTURES.slice(0, 7),
	);
	const [suggestions, setSuggestions] = useState<SongVM[]>(() =>
		SONG_FIXTURES.slice(7, 12),
	);

	const addSong = (id: string) => {
		const song = suggestions.find((s) => s.id === id);
		if (!song) return;
		setSuggestions((prev) => prev.filter((s) => s.id !== id));
		setPreview((prev) => [...prev, song]);
	};

	const removeSong = (id: string) => {
		const song = preview.find((s) => s.id === id);
		if (!song) return;
		setPreview((prev) => prev.filter((s) => s.id !== id));
		setSuggestions((prev) => [...prev, song]);
	};

	// Rotate instead of fetching — enough to make the affordance feel alive.
	const refreshSuggestions = () => {
		setSuggestions((prev) => [...prev.slice(2), ...prev.slice(0, 2)]);
	};

	const totalMinutes = Math.round(
		preview.reduce((sum, s) => sum + (s.durationMs ?? 0), 0) / 60000,
	);

	return {
		preview,
		suggestions,
		addSong,
		removeSong,
		refreshSuggestions,
		totalMinutes,
	};
}
