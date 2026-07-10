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

// Mirrors draft-engine.ts's SUGGESTIONS_COUNT (the server's per-batch size).
// Not imported directly to keep this client hook decoupled from the scoring
// engine module; a mismatch here only affects how far one refresh advances,
// never correctness (assembleDraft clamps out-of-range offsets).
const SUGGESTIONS_PAGE_SIZE = 12;

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
	/**
	 * Reverse a remove without force-pinning the song.
	 * Removes the song from excludedSongIds so the preview engine can include it
	 * again if the current config selects it — the song re-enters only if the
	 * scoring would still put it in range.
	 */
	restoreSong: (id: string) => void;
	/** Dismiss a suggestion: excludes it, same mechanism as removeSong. */
	dismissSuggestion: (id: string) => void;
	/**
	 * Page the suggestions window deeper into the ranked candidate pool without
	 * touching config, pins, or exclusions — pulls a genuinely new batch since
	 * the ranking itself doesn't change.
	 */
	refreshSuggestions: () => void;
	reset: () => void;
}

export interface CreatePlaylistDraftState {
	/** Live config — drives the controlled config inputs. */
	config: CreatePlaylistDraftConfig;
	/**
	 * The debounced config that produced the current preview. The create path
	 * must submit THIS (not the live config): otherwise a config edited within
	 * the debounce window is persisted as the playlist's match config while the
	 * preview — and therefore the songs actually added — still reflects the old
	 * config.
	 */
	committedConfig: CreatePlaylistDraftConfig;
	/**
	 * True while a config edit is still pending debounce — the preview is stale
	 * relative to `config`. Create should be blocked until this settles.
	 */
	isConfigStale: boolean;
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

	// Pages the suggestions window deeper (see DraftConfig.suggestionsOffset).
	// Reset to 0 whenever config changes — the ranking itself shifted, so an old
	// offset would point at an arbitrary, no-longer-meaningful slice. Selection
	// changes (add/dismiss) do NOT reset it: dismissing one suggestion at a time
	// shouldn't repeatedly snap the tray back to the top of the ranking.
	const [suggestionsOffset, setSuggestionsOffset] = useState(0);

	// Debounce only the config portion of the query key. Typing an intent or
	// sliding maxSongs fires a fresh debounce window rather than a fetch per
	// keystroke. Selection changes (add/remove) are not debounced — they bypass
	// the window by being read live from state, giving instant preview feedback.
	const debouncedConfig = useDebounce(config, DEBOUNCE_MS);

	// Reference inequality is exact here: setConfig always produces a new object
	// and useDebounce settles back to that same reference, so config !==
	// debouncedConfig holds precisely while a debounce is in flight.
	const isConfigStale = config !== debouncedConfig;

	// debouncedConfig is the trigger for this reset, not a value read in the
	// body — removing it from the deps (biome's autofix) would make this run
	// only once on mount instead of on every config change.
	// biome-ignore lint/correctness/useExhaustiveDependencies: trigger-only dependency, see comment above
	useEffect(() => {
		setSuggestionsOffset(0);
	}, [debouncedConfig]);

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
		suggestionsOffset,
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

	const restoreSong = useCallback((id: string) => {
		setSelection((prev) => ({
			pinnedSongIds: prev.pinnedSongIds,
			excludedSongIds: prev.excludedSongIds.filter((eid) => eid !== id),
		}));
	}, []);

	// Dismissing a suggestion is semantically "reject a suggestion" rather than
	// "undo a pin", but the underlying state transition is identical to
	// removeSong. Aliased (not reimplemented) so the two can never drift apart.
	const dismissSuggestion = removeSong;

	const refreshSuggestions = useCallback(() => {
		setSuggestionsOffset((prev) => prev + SUGGESTIONS_PAGE_SIZE);
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
		setSuggestionsOffset(0);
	}, []);

	return {
		config,
		committedConfig: debouncedConfig,
		isConfigStale,
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
		restoreSong,
		dismissSuggestion,
		refreshSuggestions,
		reset,
	};
}
