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
 * addSong: moves a suggestion into pinnedSongIds and clears it from
 *   excludedSongIds and releasedSongIds (pinning overrides both stances).
 */

import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { allocateArtistPins } from "@/lib/domains/playlists/artist-allocation";
import { SUGGESTIONS_COUNT } from "@/lib/domains/playlists/constants";
import { MAX_PINNED_SONG_IDS } from "@/lib/domains/playlists/draft-engine";
import type { SongVM } from "@/lib/domains/playlists/types";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import {
	type PlaylistDraftPreview,
	recordStudioActions,
} from "@/lib/server/playlist-draft.functions";
import type { DraftConfig } from "./queries";
import {
	artistSongResolutionQueryOptions,
	DEFAULT_DRAFT_CONFIG,
	playlistDraftPreviewQueryOptions,
} from "./queries";

const DEBOUNCE_MS = 600;
type StudioActionType = "add" | "pin" | "remove" | "dismiss";

export interface CreatePlaylistDraftConfig {
	intent?: string;
	genrePills: string[];
	matchFilters: PlaylistMatchFiltersV1;
	maxSongs: number;
}

/**
 * Seed values the studio opens with, carried across the entrance→studio route
 * boundary (see studioSeed.ts). Read ONCE at mount via lazy state initializers
 * — the studio route derives these from stable search params, so re-seeding
 * means a fresh mount, not a mid-life mutation.
 */
export interface CreatePlaylistDraftInit {
	intent?: string;
	genrePills?: string[];
	matchFilters?: PlaylistMatchFiltersV1;
	/** Artists to seed the "Around" selection with — all enabled. */
	artists?: string[];
}

export interface CreatePlaylistDraftSelection {
	/** MANUAL pins only — songs the user hand-added. Artist-derived pins are
	 *  computed from artistSelections at query-key time and never stored here,
	 *  so toggling/removing an artist can't disturb manual pins by construction. */
	pinnedSongIds: string[];
	excludedSongIds: string[];
	/**
	 * Songs the user un-pinned. NOT exclusions — they stay eligible for the
	 * ranked fill and suggestions — but the artist allocator skips them, so a
	 * release can't be silently re-derived into a pin while its artist stays
	 * anchored. Cleared per song by pinning again; never crosses the wire.
	 */
	releasedSongIds: string[];
}

/** One selected artist in the studio's multi-artist "Around" selection. */
export interface ArtistSelection {
	name: string;
	/** Disabled artists stay in the list (dimmed chip) but contribute no pins. */
	enabled: boolean;
}

/** ArtistSelection enriched with its resolution status. */
export interface ArtistSelectionVM extends ArtistSelection {
	/** Preview-eligible liked-song count (filter-independent) — the size of the
	 *  pool anchor pins draw from, matching the search dropdown's number; null
	 *  while resolution pends. */
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
	 * Flip a preview row's pin between forced and neutral. An unpinned row
	 * becomes a manual pin (same transition as addSong). A pinned row — manual
	 * or artist-derived alike — releases: it leaves pinnedSongIds and joins
	 * releasedSongIds, which the artist allocator skips, so the song re-enters
	 * the tracklist or suggestions only on merit. Release is never an
	 * exclusion; banishment stays with removeSong. (This reverses D3's
	 * exclude-on-unpin — see docs/playlist-creation/pin-semantics-decisions.md.)
	 */
	togglePin: (id: string) => void;
	/**
	 * Add an artist to the selection (enabled), or re-enable it if already
	 * present. Song resolution is asynchronous — the chip shows a pending state
	 * until the resolution query settles.
	 */
	addArtist: (name: string) => void;
	/** Flip an artist's enabled state; disabled artists contribute no pins. */
	toggleArtist: (name: string) => void;
	/** Drop the artist from the selection entirely (chip ✕). Re-add via search. */
	removeArtist: (name: string) => void;
	/**
	 * Re-fetches the artist song resolution after a failure. Resolution errors
	 * otherwise have no recovery path short of removing and re-adding every
	 * artist chip, so this is the retry the ArtistConfig panel wires to its
	 * error affordance.
	 */
	retryArtistResolution: () => void;
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
	 * True while the rendered preview does not yet reflect the live config and
	 * selection — either a config edit is pending debounce, or the re-fetch for
	 * a changed query key is still in flight (the previous tracklist stays
	 * rendered as placeholder data meanwhile). Create must be blocked until
	 * this settles: submitting mid-window would pair the new committedConfig
	 * with the old tracklist.
	 */
	isConfigStale: boolean;
	/**
	 * True while the rendered tracklist is placeholder data from a PREVIOUS
	 * query key — the fetch for the current config/selection is still in
	 * flight. Narrower than isConfigStale (no debounce window).
	 */
	isPreviewRefreshing: boolean;
	selection: CreatePlaylistDraftSelection;
	/** Selected artists (chips), in add order, with total liked-song counts. */
	artistSelections: ArtistSelectionVM[];
	/**
	 * True while the artist song resolution query is in flight (including
	 * background refetches on the 30s staleTime). Until it lands, resolved
	 * pools default to empty, so submitting now would silently create the
	 * playlist without any of the pending artists' songs — Create must be
	 * blocked on this exactly like a mid-debounce config edit.
	 */
	isResolvingArtists: boolean;
	/**
	 * True when the artist song resolution query failed. Left unhandled, the
	 * chips would show a pending "…" forever with no explanation, AND
	 * submitting would silently create the playlist with every selected
	 * artist's pool empty. Both CreateBar (blocks submit) and ArtistConfig
	 * (surfaces the failure + retry) read this.
	 */
	isArtistResolutionError: boolean;
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

export function useCreatePlaylistDraft(
	init?: CreatePlaylistDraftInit,
): UseCreatePlaylistDraftResult {
	const [studioSessionId] = useState(() => crypto.randomUUID());
	const [config, setConfig] = useState<CreatePlaylistDraftConfig>(() => ({
		intent: init?.intent ?? DEFAULT_DRAFT_CONFIG.intent,
		genrePills: init?.genrePills ?? DEFAULT_DRAFT_CONFIG.genrePills,
		matchFilters: init?.matchFilters ?? DEFAULT_DRAFT_CONFIG.matchFilters,
		maxSongs: DEFAULT_DRAFT_CONFIG.maxSongs,
	}));

	const [selection, setSelection] = useState<CreatePlaylistDraftSelection>({
		pinnedSongIds: DEFAULT_DRAFT_CONFIG.pinnedSongIds,
		excludedSongIds: DEFAULT_DRAFT_CONFIG.excludedSongIds,
		releasedSongIds: [],
	});

	// The multi-artist "Around" selection. Ephemeral draft state: only names +
	// enabled flags live here; the song ids come from the resolution query below,
	// which is filter-independent (anchor pins are filter-exempt), so a filter
	// change leaves them untouched.
	const [artistSelections, setArtistSelections] = useState<ArtistSelection[]>(
		() => (init?.artists ?? []).map((name) => ({ name, enabled: true })),
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
	const isDebouncePending = config !== debouncedConfig;

	// debouncedConfig is the trigger for this reset, not a value read in the
	// body — removing it from the deps (biome's autofix) would make this run
	// only once on mount instead of on every config change.
	// biome-ignore lint/correctness/useExhaustiveDependencies: trigger-only dependency, see comment above
	useEffect(() => {
		setSuggestionsOffset(0);
	}, [debouncedConfig]);

	// Resolve every selected artist (enabled AND disabled — dimmed chips still
	// show honest counts) into their preview-eligible liked songs. Filter-
	// INDEPENDENT: an anchor artist is a filter-exempt pin, so its pool (and
	// the chip count) never re-resolves when filters change.
	const artistNames = useMemo(
		() => artistSelections.map((a) => a.name),
		[artistSelections],
	);
	const artistResolution = useQuery(
		artistSongResolutionQueryOptions(artistNames),
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
		// Ids the allocator must not spend slots on. Excluded: the engine drops
		// them server-side (droppedPinnedSongIds), so they'd burn a slot on a
		// song that can never appear. Released: the user un-pinned them, and
		// re-deriving the pin would make release a visible no-op. Manual pins:
		// they already come off the top of the budget below — allocating one
		// again would collapse in the union and leave the tracklist a slot
		// short. In every case the artist's next song takes the slot instead.
		const withheld = new Set([
			...selection.excludedSongIds,
			...selection.releasedSongIds,
			...manualPinnedSongIds,
		]);
		const pools = artistSelections
			.filter((a) => a.enabled)
			.map((a) => ({
				name: a.name,
				songIds: (resolvedSongIdsByArtist.get(a.name) ?? []).filter(
					(id) => !withheld.has(id),
				),
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
		manualPinnedSongIds,
		selection.excludedSongIds,
		selection.releasedSongIds,
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
		// Ids past the wire bound are also past maxSongs, so the engine would
		// drop-and-report them anyway — this clamp can only ever shorten the
		// droppedPinnedSongIds report, never the kept tracklist.
		return union.slice(0, MAX_PINNED_SONG_IDS);
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
		excludedSongIds: selection.excludedSongIds,
		suggestionsOffset,
	};

	const { data, isLoading, isError, isPlaceholderData } = useQuery(
		playlistDraftPreviewQueryOptions(queryConfig),
	);

	const result = data ?? EMPTY_PREVIEW_RESULT;
	// keepPreviousData preserves the old cohort during a refetch, but an exclusion
	// is already authoritative client state and should not wait on the network.
	const excludedSongIds = useMemo(
		() => new Set(selection.excludedSongIds),
		[selection.excludedSongIds],
	);
	const visibleTracklist = useMemo(
		() => result.tracklist.filter((song) => !excludedSongIds.has(song.id)),
		[result.tracklist, excludedSongIds],
	);
	// keepPreviousData also means a just-added suggestion lingers in the OLD
	// cohort until the next preview resolves — filtering against the current
	// effective pins (not just exclusions) drops it the instant Add is clicked,
	// so the row can't be double-added while the refetch is in flight.
	const effectivePinnedSongIdSet = useMemo(
		() => new Set(effectivePinnedSongIds),
		[effectivePinnedSongIds],
	);
	const visibleSuggestions = useMemo(
		() =>
			result.suggestions.filter(
				(song) =>
					!excludedSongIds.has(song.id) &&
					!effectivePinnedSongIdSet.has(song.id),
			),
		[result.suggestions, excludedSongIds, effectivePinnedSongIdSet],
	);

	// isPlaceholderData is precisely "the shown data belongs to a previous
	// query key" — a plain background refetch of the SAME key does not set it,
	// so it never blocks Create on a mere staleTime revalidation.
	const isConfigStale = isDebouncePending || isPlaceholderData;

	// Logging is deliberately detached from the state transition: an unavailable
	// telemetry path must not delay or surface an interaction failure.
	const recordStudioAction = useCallback(
		(action: StudioActionType, songId: string) => {
			const tracklistPosition = visibleTracklist.findIndex(
				(song) => song.id === songId,
			);
			const suggestionPosition = visibleSuggestions.findIndex(
				(song) => song.id === songId,
			);
			const position =
				tracklistPosition >= 0
					? tracklistPosition
					: suggestionPosition >= 0
						? suggestionPosition
						: null;

			void (async () => {
				try {
					await recordStudioActions({
						data: {
							sessionId: studioSessionId,
							actions: [
								{
									songId,
									action,
									position,
									context: {
										genrePills: config.genrePills,
										matchFilters: config.matchFilters,
										intentPresent: Boolean(config.intent?.trim()),
									},
								},
							],
						},
					});
				} catch {
					// Logging is optional collection and never an interaction outcome.
				}
			})();
		},
		[config, studioSessionId, visibleSuggestions, visibleTracklist],
	);

	// These transitions are shared by public callbacks so aliases cannot change
	// the action label or record the same state change twice.
	const removeSongTransition = useCallback((id: string) => {
		setSelection((prev) => ({
			...prev,
			pinnedSongIds: prev.pinnedSongIds.filter((pid) => pid !== id),
			excludedSongIds: prev.excludedSongIds.includes(id)
				? prev.excludedSongIds
				: [...prev.excludedSongIds, id],
		}));
	}, []);

	const addSongTransition = useCallback((id: string) => {
		setSelection((prev) => ({
			...prev,
			pinnedSongIds: prev.pinnedSongIds.includes(id)
				? prev.pinnedSongIds
				: [...prev.pinnedSongIds, id],
			excludedSongIds: prev.excludedSongIds.filter((eid) => eid !== id),
			releasedSongIds: prev.releasedSongIds.filter((rid) => rid !== id),
		}));
	}, []);

	const releasePinTransition = useCallback((id: string) => {
		setSelection((prev) => ({
			...prev,
			pinnedSongIds: prev.pinnedSongIds.filter((pid) => pid !== id),
			releasedSongIds: prev.releasedSongIds.includes(id)
				? prev.releasedSongIds
				: [...prev.releasedSongIds, id],
		}));
	}, []);

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

	const removeSong = useCallback(
		(id: string) => {
			removeSongTransition(id);
			recordStudioAction("remove", id);
		},
		[recordStudioAction, removeSongTransition],
	);

	const addSong = useCallback(
		(id: string) => {
			addSongTransition(id);
			recordStudioAction("add", id);
		},
		[addSongTransition, recordStudioAction],
	);

	// The two-way pin routing (see the interface doc). The shared add transition
	// keeps pinning and adding behavior aligned without sharing their log label.
	// Release records the id even for pure-manual pins whose artist isn't anchored
	// yet, so anchoring that artist later cannot resurrect a dropped pin.
	const togglePin = useCallback(
		(id: string) => {
			if (!effectivePinnedSongIds.includes(id)) {
				addSongTransition(id);
				recordStudioAction("pin", id);
				return;
			}
			releasePinTransition(id);
		},
		[
			addSongTransition,
			effectivePinnedSongIds,
			recordStudioAction,
			releasePinTransition,
		],
	);

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

	// Deliberately leaves releasedSongIds alone: undoing a remove restores the
	// song's pre-remove stance, and a previously released song was present on
	// merit, not as a pin — un-excluding must not re-arm the allocator for it.
	const restoreSong = useCallback((id: string) => {
		setSelection((prev) => ({
			...prev,
			excludedSongIds: prev.excludedSongIds.filter((eid) => eid !== id),
		}));
	}, []);

	// refetch() is the react-query escape hatch for a failed query — there's no
	// other way back to a resolved state without removing and re-adding every
	// artist chip (which would also lose the enabled/disabled toggle state).
	const { refetch: refetchArtistResolution } = artistResolution;
	const retryArtistResolution = useCallback(() => {
		void refetchArtistResolution();
	}, [refetchArtistResolution]);

	// Dismissing a suggestion shares the exclusion transition with removeSong,
	// but keeps its own event label because the two gestures mean different things.
	const dismissSuggestion = useCallback(
		(id: string) => {
			removeSongTransition(id);
			recordStudioAction("dismiss", id);
		},
		[recordStudioAction, removeSongTransition],
	);

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
			releasedSongIds: [],
		});
		setArtistSelections([]);
		setSuggestionsOffset(0);
	}, []);

	// Chip VMs: count is null (pending) only for artists absent from the
	// resolved map. keepPreviousData keeps already-resolved artists in that map
	// while a newly added one resolves, so adding artist B never blanks A's
	// count — the pending state is per-chip, exactly the unresolved ones.
	const artistSelectionVMs: ArtistSelectionVM[] = useMemo(
		() =>
			artistSelections.map((a) => ({
				...a,
				songCount: resolvedSongIdsByArtist.get(a.name)?.length ?? null,
			})),
		[artistSelections, resolvedSongIdsByArtist],
	);

	return {
		config,
		committedConfig: debouncedConfig,
		isConfigStale,
		isPreviewRefreshing: isPlaceholderData,
		selection,
		artistSelections: artistSelectionVMs,
		isResolvingArtists: artistResolution.isFetching,
		isArtistResolutionError: artistResolution.isError,
		effectivePinnedSongIds,
		tracklist: visibleTracklist,
		suggestions: visibleSuggestions,
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
		togglePin,
		addArtist,
		toggleArtist,
		removeArtist,
		retryArtistResolution,
		restoreSong,
		dismissSuggestion,
		refreshSuggestions,
		reset,
	};
}
