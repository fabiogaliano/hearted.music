/**
 * Central draft-state hook for the playlist creation feature.
 *
 * Owns all ephemeral draft state: the config that drives the preview query
 * (intent, genre pills, match filters, maxSongs) and the selection state
 * (pinned / excluded song IDs). Changes to config are debounced ~600ms before
 * they update the query key, preventing rapid re-fetches while the user is
 * actively adjusting sliders or typing.
 *
 * removeSong: moves a preview song into excludedSongIds and drops it from
 *   pinnedSongIds (it was pinned, so clearing both is correct).
 * addSong: moves a suggestion into pinnedSongIds and removes it from
 *   excludedSongIds (in case the user had previously removed it).
 */

import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import type { SongVM } from "@/lib/domains/playlists/types";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import type { PreviewPlaylistDraftResult } from "@/lib/server/playlist-draft.functions";
import type { DraftConfig } from "./queries";
import {
	DEFAULT_DRAFT_CONFIG,
	playlistDraftPreviewQueryOptions,
} from "./queries";

const DEBOUNCE_MS = 600;

export interface CreatePlaylistDraftConfig {
	intent?: string;
	genrePills: string[];
	matchFilters: PlaylistMatchFiltersV1;
	maxSongs: number;
}

export interface CreatePlaylistDraftSelection {
	pinnedSongIds: string[];
	excludedSongIds: string[];
}

export interface CreatePlaylistDraftActions {
	setIntent: (intent: string | undefined) => void;
	setGenrePills: (pills: string[]) => void;
	setMatchFilters: (filters: PlaylistMatchFiltersV1) => void;
	setMaxSongs: (max: number) => void;
	/** Move a preview song into excludedSongIds; T6 will trigger an undo toast. */
	removeSong: (id: string) => void;
	/** Move a suggestion into pinnedSongIds; clears any previous exclusion. */
	addSong: (id: string) => void;
	reset: () => void;
}

export interface CreatePlaylistDraftState {
	config: CreatePlaylistDraftConfig;
	selection: CreatePlaylistDraftSelection;
	preview: SongVM[];
	suggestions: SongVM[];
	totalEligible: number;
	intentApplied: boolean;
	isLoading: boolean;
	isError: boolean;
}

export type UseCreatePlaylistDraftResult = CreatePlaylistDraftState &
	CreatePlaylistDraftActions;

function useDebounce<T>(value: T, delayMs: number): T {
	const [debounced, setDebounced] = useState<T>(value);
	useEffect(() => {
		const id = window.setTimeout(() => setDebounced(value), delayMs);
		return () => window.clearTimeout(id);
	}, [value, delayMs]);
	return debounced;
}

const EMPTY_PREVIEW_RESULT: PreviewPlaylistDraftResult = {
	preview: [],
	suggestions: [],
	totalEligible: 0,
	intentApplied: false,
};

export function useCreatePlaylistDraft(): UseCreatePlaylistDraftResult {
	const [config, setConfig] = useState<CreatePlaylistDraftConfig>({
		intent: DEFAULT_DRAFT_CONFIG.intent,
		genrePills: DEFAULT_DRAFT_CONFIG.genrePills,
		matchFilters: DEFAULT_DRAFT_CONFIG.matchFilters,
		maxSongs: DEFAULT_DRAFT_CONFIG.maxSongs,
	});

	const [selection, setSelection] = useState<CreatePlaylistDraftSelection>({
		pinnedSongIds: DEFAULT_DRAFT_CONFIG.pinnedSongIds,
		excludedSongIds: DEFAULT_DRAFT_CONFIG.excludedSongIds,
	});

	// Debounce only the config portion of the query key. Typing an intent or
	// sliding maxSongs fires a fresh debounce window rather than a fetch per
	// keystroke. Selection changes (add/remove) are not debounced — they bypass
	// the window by being read live from state, giving instant preview feedback.
	const debouncedConfig = useDebounce(config, DEBOUNCE_MS);

	// The query key is the debounced config + live selection. Selection changes
	// (add/remove) bypass the config debounce by depending directly on selection,
	// giving instant visual feedback when the user pins or excludes songs.
	const queryConfig: DraftConfig = {
		intent: debouncedConfig.intent,
		genrePills: debouncedConfig.genrePills,
		matchFilters: debouncedConfig.matchFilters,
		maxSongs: debouncedConfig.maxSongs,
		pinnedSongIds: selection.pinnedSongIds,
		excludedSongIds: selection.excludedSongIds,
	};

	const { data, isLoading, isError } = useQuery(
		playlistDraftPreviewQueryOptions(queryConfig),
	);

	const result = data ?? EMPTY_PREVIEW_RESULT;

	// --- Stable action callbacks ---

	const setIntent = useCallback((intent: string | undefined) => {
		setConfig((prev) => ({ ...prev, intent }));
	}, []);

	const setGenrePills = useCallback((genrePills: string[]) => {
		setConfig((prev) => ({ ...prev, genrePills }));
	}, []);

	const setMatchFilters = useCallback(
		(matchFilters: PlaylistMatchFiltersV1) => {
			setConfig((prev) => ({ ...prev, matchFilters }));
		},
		[],
	);

	const setMaxSongs = useCallback((maxSongs: number) => {
		setConfig((prev) => ({ ...prev, maxSongs }));
	}, []);

	const removeSong = useCallback((id: string) => {
		setSelection((prev) => ({
			pinnedSongIds: prev.pinnedSongIds.filter((pid) => pid !== id),
			excludedSongIds: prev.excludedSongIds.includes(id)
				? prev.excludedSongIds
				: [...prev.excludedSongIds, id],
		}));
	}, []);

	const addSong = useCallback((id: string) => {
		setSelection((prev) => ({
			pinnedSongIds: prev.pinnedSongIds.includes(id)
				? prev.pinnedSongIds
				: [...prev.pinnedSongIds, id],
			excludedSongIds: prev.excludedSongIds.filter((eid) => eid !== id),
		}));
	}, []);

	const reset = useCallback(() => {
		setConfig({
			intent: DEFAULT_DRAFT_CONFIG.intent,
			genrePills: DEFAULT_DRAFT_CONFIG.genrePills,
			matchFilters: DEFAULT_DRAFT_CONFIG.matchFilters,
			maxSongs: DEFAULT_DRAFT_CONFIG.maxSongs,
		});
		setSelection({
			pinnedSongIds: [],
			excludedSongIds: [],
		});
	}, []);

	return {
		config,
		selection,
		preview: result.preview,
		suggestions: result.suggestions,
		totalEligible: result.totalEligible,
		intentApplied: result.intentApplied,
		isLoading,
		isError,
		setIntent,
		setGenrePills,
		setMatchFilters,
		setMaxSongs,
		removeSong,
		addSong,
		reset,
	};
}
