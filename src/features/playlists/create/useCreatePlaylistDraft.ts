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
import { useCallback, useEffect, useMemo, useState } from "react";
import { allocateArtistPins } from "@/lib/domains/playlists/artist-allocation";
import { SUGGESTIONS_COUNT } from "@/lib/domains/playlists/constants";
import type { SongVM } from "@/lib/domains/playlists/types";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import type { PlaylistDraftPreview } from "@/lib/server/playlist-draft.functions";
import type { DraftConfig } from "./queries";
import {
	artistSongResolutionQueryOptions,
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
	/** MANUAL pins only — songs the user hand-added. Artist-derived pins are
	 *  computed from artistSelections at query-key time and never stored here,
	 *  so toggling/removing an artist can't disturb manual pins by construction. */
	pinnedSongIds: string[];
	excludedSongIds: string[];
}

/** One selected artist in the studio's multi-artist "Around" selection. */
export interface ArtistSelection {
	name: string;
	/** Disabled artists stay in the list (dimmed chip) but contribute no pins. */
	enabled: boolean;
}

/** ArtistSelection enriched with its filter-aware resolution status. */
export interface ArtistSelectionVM extends ArtistSelection {
	/** Filter-aware pinnable song count; null while the resolution is pending. */
	songCount: number | null;
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
	 * Add an artist to the selection (enabled), or re-enable it if already
	 * present. Song resolution is filter-aware and asynchronous — the chip shows
	 * a pending state until the resolution query settles.
	 */
	addArtist: (name: string) => void;
	/** Flip an artist's enabled state; disabled artists contribute no pins. */
	toggleArtist: (name: string) => void;
	/** Drop the artist from the selection entirely (chip ✕, undo via restoreArtist). */
	removeArtist: (name: string) => void;
	/** Re-insert a removed artist at its prior position — the Undo toast action. */
	restoreArtist: (selection: ArtistSelection, index: number) => void;
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
	/** Selected artists (chips), in add order, with filter-aware song counts. */
	artistSelections: ArtistSelectionVM[];
	/** True while the artist song resolution query is in flight. */
	isResolvingArtists: boolean;
	/**
	 * The deduplicated, ordered union actually sent as pins: balanced artist
	 * allocation first, then manual pins. What the tracklist's pinned block is.
	 */
	effectivePinnedSongIds: string[];
	/** Songs currently in the draft (pins first, then ranked fill), ≤ maxSongs. */
	tracklist: SongVM[];
	suggestions: SongVM[];
	totalEligible: number;
	intentApplied: boolean;
	/** Pinned ids the engine could not honor — excluded, filtered out, or clamped. */
	droppedPinnedSongIds: string[];
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

const EMPTY_PREVIEW_RESULT: PlaylistDraftPreview = {
	tracklist: [],
	suggestions: [],
	totalEligible: 0,
	intentApplied: false,
	droppedPinnedSongIds: [],
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

	// The multi-artist "Around" selection. Ephemeral draft state: only names +
	// enabled flags live here; the filter-aware song ids come from the
	// resolution query below, so a filter change re-resolves them without any
	// imperative bookkeeping.
	const [artistSelections, setArtistSelections] = useState<ArtistSelection[]>(
		[],
	);

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

	// Resolve every selected artist (enabled AND disabled — dimmed chips still
	// show honest counts) against the DEBOUNCED filters, matching the preview's
	// own filter timing so allocation never mixes filter generations.
	const artistNames = useMemo(
		() => artistSelections.map((a) => a.name),
		[artistSelections],
	);
	const artistResolution = useQuery(
		artistSongResolutionQueryOptions(artistNames, debouncedConfig.matchFilters),
	);
	const resolvedSongIdsByArtist = useMemo(() => {
		const map = new Map<string, string[]>();
		for (const entry of artistResolution.data?.artists ?? []) {
			map.set(entry.name, entry.songIds);
		}
		return map;
	}, [artistResolution.data]);

	// Balanced allocation: manual pins are commitments and come off the top of
	// the budget; the enabled artists split the rest evenly (with redistribution
	// + interleave inside the allocator). Keyed off the DEBOUNCED maxSongs so a
	// slider mid-drag doesn't thrash the allocation.
	const manualPinnedSongIds = selection.pinnedSongIds;
	const artistPinIds = useMemo(() => {
		const pools = artistSelections
			.filter((a) => a.enabled)
			.map((a) => ({
				name: a.name,
				songIds: resolvedSongIdsByArtist.get(a.name) ?? [],
			}));
		const slots = Math.max(
			0,
			debouncedConfig.maxSongs - manualPinnedSongIds.length,
		);
		return allocateArtistPins(pools, slots);
	}, [
		artistSelections,
		resolvedSongIdsByArtist,
		debouncedConfig.maxSongs,
		manualPinnedSongIds.length,
	]);

	// The effective ordered union: artist allocation first, manual pins after,
	// deduplicated, and clamped to the schema bound. Derived at query-key
	// assembly time and never stored merged — provenance stays explicit.
	const effectivePinnedSongIds = useMemo(() => {
		const seen = new Set<string>();
		const union: string[] = [];
		for (const id of [...artistPinIds, ...manualPinnedSongIds]) {
			if (!seen.has(id)) {
				seen.add(id);
				union.push(id);
			}
		}
		return union.slice(0, 50);
	}, [artistPinIds, manualPinnedSongIds]);

	// The query key is the debounced config + live selection. Selection changes
	// (add/remove) bypass the config debounce by depending directly on selection,
	// giving instant visual feedback when the user pins or excludes songs.
	const queryConfig: DraftConfig = {
		intent: debouncedConfig.intent,
		genrePills: debouncedConfig.genrePills,
		matchFilters: debouncedConfig.matchFilters,
		maxSongs: debouncedConfig.maxSongs,
		pinnedSongIds: effectivePinnedSongIds,
		manualPinnedSongIds: manualPinnedSongIds.slice(0, 50),
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

	const addArtist = useCallback((name: string) => {
		setArtistSelections((prev) => {
			const existing = prev.find((a) => a.name === name);
			if (existing) {
				// Search unifies "add" and "activate": adding an already-present
				// artist re-enables it rather than duplicating the chip.
				return existing.enabled
					? prev
					: prev.map((a) => (a.name === name ? { ...a, enabled: true } : a));
			}
			return [...prev, { name, enabled: true }];
		});
	}, []);

	const toggleArtist = useCallback((name: string) => {
		setArtistSelections((prev) =>
			prev.map((a) => (a.name === name ? { ...a, enabled: !a.enabled } : a)),
		);
	}, []);

	const removeArtist = useCallback((name: string) => {
		setArtistSelections((prev) => prev.filter((a) => a.name !== name));
	}, []);

	const restoreArtist = useCallback(
		(restored: ArtistSelection, index: number) => {
			setArtistSelections((prev) => {
				if (prev.some((a) => a.name === restored.name)) return prev;
				const next = [...prev];
				next.splice(Math.min(index, next.length), 0, restored);
				return next;
			});
		},
		[],
	);

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
		setSuggestionsOffset((prev) => prev + SUGGESTIONS_COUNT);
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
		setArtistSelections([]);
		setSuggestionsOffset(0);
	}, []);

	// Chip VMs: count is null (pending) until the resolution for the CURRENT
	// filter generation has landed; isFetching covers the re-resolve window
	// after a filter change, when cached data would otherwise show stale counts.
	const artistSelectionVMs: ArtistSelectionVM[] = useMemo(
		() =>
			artistSelections.map((a) => ({
				...a,
				songCount: artistResolution.isFetching
					? null
					: (resolvedSongIdsByArtist.get(a.name)?.length ?? null),
			})),
		[artistSelections, resolvedSongIdsByArtist, artistResolution.isFetching],
	);

	return {
		config,
		committedConfig: debouncedConfig,
		isConfigStale,
		selection,
		artistSelections: artistSelectionVMs,
		isResolvingArtists: artistResolution.isFetching,
		effectivePinnedSongIds,
		tracklist: result.tracklist,
		suggestions: result.suggestions,
		totalEligible: result.totalEligible,
		intentApplied: result.intentApplied,
		droppedPinnedSongIds: result.droppedPinnedSongIds,
		isLoading,
		isError,
		setIntent,
		setGenrePills,
		setMatchFilters,
		setMaxSongs,
		removeSong,
		addSong,
		addArtist,
		toggleArtist,
		removeArtist,
		restoreArtist,
		restoreSong,
		dismissSuggestion,
		refreshSuggestions,
		reset,
	};
}
