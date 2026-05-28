import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Playlist } from "@/lib/domains/library/playlists/queries";
import { useIsomorphicLayoutEffect } from "@/lib/hooks/useIsomorphicLayoutEffect";
import { scrollListElementIntoView } from "@/lib/keyboard/listScroll";
import type { ListNavigationResult } from "@/lib/keyboard/types";
import { useListNavigation } from "@/lib/keyboard/useListNavigation";
import { useShortcut } from "@/lib/keyboard/useShortcut";
import { fonts } from "@/lib/theme/fonts";
import type { ThemeConfig } from "@/lib/theme/types";
import { ActivePlaylistsPanel } from "./components/ActivePlaylistsPanel";
import { PlaylistDetailView } from "./components/PlaylistDetailView";
import { PlaylistLibrary } from "./components/PlaylistLibrary";
import { PlaylistsHeader } from "./components/PlaylistsHeader";
import { useExtensionStatus } from "./hooks/useExtensionStatus";
import { usePlaylistExpansion } from "./hooks/usePlaylistExpansion";
import { usePlaylistSession } from "./hooks/usePlaylistSession";
import {
	buildPlaylistRouteRef,
	resolvePlaylistIdFromRouteRef,
} from "./playlistRouteRef";
import { playlistManagementQueryOptions } from "./queries";

type PlaylistColumn = "matching" | "available";

interface PlaylistsScreenProps {
	theme: ThemeConfig;
	accountId: string;
}

export function PlaylistsScreen({ theme, accountId }: PlaylistsScreenProps) {
	// strict:false lets this read the param when the active match is
	// /playlists/$playlistRef and return undefined when on /playlists.
	const { playlistRef: selectedPlaylistRef } = useParams({ strict: false });
	const { data } = useQuery(playlistManagementQueryOptions(accountId));
	const { extensionStatus } = useExtensionStatus();
	const { optimisticTargets, toggleTarget, markMetadataChanged } =
		usePlaylistSession(accountId);
	const playlists = data?.playlists ?? [];
	const playlistRouteRefsById = useMemo(
		() =>
			new Map(
				playlists.map((playlist) => [
					playlist.id,
					buildPlaylistRouteRef(playlist),
				]),
			),
		[playlists],
	);
	const routePlaylistId = useMemo(
		() => resolvePlaylistIdFromRouteRef(playlists, selectedPlaylistRef),
		[playlists, selectedPlaylistRef],
	);

	const {
		selectedPlaylistId,
		isExpanded,
		startRect,
		expandedRect,
		expansionColumnRef,
		handleExpand,
		handleClose,
		closingToPlaylistId,
	} = usePlaylistExpansion({
		selectedPlaylistId: routePlaylistId,
		getRouteRefForPlaylistId: (playlistId) =>
			playlistRouteRefsById.get(playlistId) ?? null,
	});

	const targetIds = useMemo(() => {
		if (!data) return new Set<string>();
		const ids = new Set(data.targetPlaylistIds);
		for (const [id, isTarget] of optimisticTargets) {
			if (isTarget) ids.add(id);
			else ids.delete(id);
		}
		return ids;
	}, [data, optimisticTargets]);

	const [searchQuery, setSearchQuery] = useState("");
	const normalizedQuery = searchQuery.trim().toLowerCase();
	const isSearching = normalizedQuery.length > 0;

	const { targetPlaylists, availablePlaylists } = useMemo(() => {
		if (!data) return { targetPlaylists: [], availablePlaylists: [] };
		// Filter runs over both columns simultaneously so a single query feels
		// like one search across the user's full library — not two siloed
		// searches that could leave a hit hidden in the unfocused column.
		const matchesQuery = (p: Playlist) => {
			if (!isSearching) return true;
			const haystack = `${p.name} ${p.description ?? ""}`.toLowerCase();
			return haystack.includes(normalizedQuery);
		};
		return {
			targetPlaylists: data.playlists.filter(
				(p) => targetIds.has(p.id) && matchesQuery(p),
			),
			availablePlaylists: data.playlists.filter(
				(p) => !targetIds.has(p.id) && matchesQuery(p),
			),
		};
	}, [data, targetIds, isSearching, normalizedQuery]);

	// Forward-refs let each hook's callbacks reach the other's focusIndex even
	// though one is declared before the other. Assigned right after both hooks
	// run so the refs always point at the latest result object.
	const matchingNavRef = useRef<ListNavigationResult<Playlist> | null>(null);
	const availableNavRef = useRef<ListNavigationResult<Playlist> | null>(null);
	const detailOriginColumnRef = useRef<PlaylistColumn | null>(null);
	const targetIdsRef = useRef(targetIds);
	targetIdsRef.current = targetIds;

	const handleExpandFromColumn = useCallback(
		(id: string, element: HTMLElement) => {
			detailOriginColumnRef.current = targetIdsRef.current.has(id)
				? "matching"
				: "available";
			handleExpand(id, element);
		},
		[handleExpand],
	);

	const focusNavIndex = useCallback(
		(nav: ListNavigationResult<Playlist> | null, index: number) => {
			if (!nav) return;
			nav.focusIndex(index, { mode: "keyboard" });
			const element = nav.getElementAtIndex(index);
			if (element) scrollListElementIntoView(element, "center");
		},
		[],
	);

	// Which column currently owns keyboard nav. Kept in React state so that
	// focus transitions trigger a re-render — that re-render is what flips the
	// `enabled` flag of each hook and re-registers (or unregisters) shortcuts.
	// `null` means neither column has been focused yet; we fall back to
	// whichever column has rows so the first `j` from a fresh page has
	// somewhere to go.
	const [activeColumn, setActiveColumn] = useState<PlaylistColumn | null>(null);

	const matchingEnabled =
		!isExpanded &&
		(activeColumn === "matching" ||
			(activeColumn === null && targetPlaylists.length > 0));
	const availableEnabled =
		!isExpanded &&
		(activeColumn === "available" ||
			(activeColumn === null &&
				targetPlaylists.length === 0 &&
				availablePlaylists.length > 0));

	const matchingNav = useListNavigation<Playlist>({
		items: targetPlaylists,
		scope: "playlists-list",
		enabled: matchingEnabled,
		onSelect: (playlist, _index, element) => {
			if (element) handleExpandFromColumn(playlist.id, element);
		},
		getId: (playlist) => playlist.id,
		scrollBlock: "center",
		autoScroll: false,
		onOverflowDown: () => {
			focusNavIndex(availableNavRef.current, 0);
		},
		onLateralRight: () => {
			focusNavIndex(availableNavRef.current, 0);
		},
	});

	const availableNav = useListNavigation<Playlist>({
		items: availablePlaylists,
		scope: "playlists-list",
		enabled: availableEnabled,
		onSelect: (playlist, _index, element) => {
			if (element) handleExpandFromColumn(playlist.id, element);
		},
		getId: (playlist) => playlist.id,
		scrollBlock: "center",
		autoScroll: false,
		onOverflowUp: () => {
			const last = targetPlaylists.length - 1;
			focusNavIndex(matchingNavRef.current, last);
		},
		onLateralLeft: () => {
			focusNavIndex(matchingNavRef.current, 0);
		},
	});

	matchingNavRef.current = matchingNav;
	availableNavRef.current = availableNav;

	// Sync the active-column state from the hooks' focus-within state. The
	// effect runs after commit, so we re-render once more after focus moves —
	// that second render is where the inactive hook becomes `enabled` and
	// registers its shortcuts. The trailing `null` branch handles the case
	// where focus leaves both columns (e.g., when a column empties out).
	useEffect(() => {
		if (matchingNav.hasFocusWithin) {
			setActiveColumn("matching");
			return;
		}
		if (availableNav.hasFocusWithin) {
			setActiveColumn("available");
			return;
		}
		setActiveColumn(null);
	}, [matchingNav.hasFocusWithin, availableNav.hasFocusWithin]);

	// Source-aware scroll for matching column: keyboard → center,
	// pointer → nearest. Skip while detail is open or when source is "url".
	useIsomorphicLayoutEffect(() => {
		const change = matchingNav.lastCursorChange;
		if (isExpanded || !change || change.source === "url") return;
		const element = matchingNav.getElementAtIndex(change.index);
		if (!element) return;
		const block = change.source === "pointer" ? "nearest" : "center";
		scrollListElementIntoView(element, block);
	}, [isExpanded, matchingNav.lastCursorChange, matchingNav.getElementAtIndex]);

	useIsomorphicLayoutEffect(() => {
		const change = availableNav.lastCursorChange;
		if (isExpanded || !change || change.source === "url") return;
		const element = availableNav.getElementAtIndex(change.index);
		if (!element) return;
		const block = change.source === "pointer" ? "nearest" : "center";
		scrollListElementIntoView(element, block);
	}, [
		isExpanded,
		availableNav.lastCursorChange,
		availableNav.getElementAtIndex,
	]);

	const isFocusOnNestedPlaylistControl = useCallback((): boolean => {
		if (typeof document === "undefined") return false;
		const active = document.activeElement;
		if (!(active instanceof HTMLElement)) return false;

		const containsNestedFocus = (
			nav: ListNavigationResult<Playlist>,
			length: number,
		) => {
			for (let i = 0; i < length; i += 1) {
				const row = nav.getElementAtIndex(i);
				if (!row) continue;
				if (row === active) return false;
				if (row.contains(active)) return true;
			}
			return false;
		};

		return (
			containsNestedFocus(matchingNav, targetPlaylists.length) ||
			containsNestedFocus(availableNav, availablePlaylists.length)
		);
	}, [
		matchingNav,
		availableNav,
		targetPlaylists.length,
		availablePlaylists.length,
	]);

	// Single Enter handler dispatches to whichever column currently owns focus.
	// Space is handled inside each useListNavigation via onSelect.
	useShortcut({
		key: "enter",
		handler: () => {
			if (isFocusOnNestedPlaylistControl()) return;
			if (
				matchingNav.hasFocusWithin &&
				matchingNav.focusedIndex >= 0 &&
				matchingNav.focusedIndex < targetPlaylists.length
			) {
				const playlist = targetPlaylists[matchingNav.focusedIndex];
				const element = matchingNav.getFocusedElement();
				if (element) handleExpandFromColumn(playlist.id, element);
				return;
			}
			if (
				availableNav.focusedIndex >= 0 &&
				availableNav.focusedIndex < availablePlaylists.length
			) {
				const playlist = availablePlaylists[availableNav.focusedIndex];
				const element = availableNav.getFocusedElement();
				if (element) handleExpandFromColumn(playlist.id, element);
			}
		},
		description: "Open playlist details",
		scope: "playlists-list",
		category: "actions",
		shouldHandle: () => !isFocusOnNestedPlaylistControl(),
		enabled:
			!isExpanded &&
			(matchingNav.focusedIndex >= 0 || availableNav.focusedIndex >= 0),
	});

	// Sync cursor with route-backed selected playlist in whichever column owns it.
	useIsomorphicLayoutEffect(() => {
		if (!selectedPlaylistId) return;

		const matchIdx = targetPlaylists.findIndex(
			(p) => p.id === selectedPlaylistId,
		);
		if (matchIdx >= 0) {
			matchingNav.syncFocusedIndex(matchIdx, {
				focus: false,
				scroll: !isExpanded,
				scrollBlock: "center",
				source: "url",
			});
			return;
		}

		const availIdx = availablePlaylists.findIndex(
			(p) => p.id === selectedPlaylistId,
		);
		if (availIdx >= 0) {
			availableNav.syncFocusedIndex(availIdx, {
				focus: false,
				scroll: !isExpanded,
				scrollBlock: "center",
				source: "url",
			});
		}
	}, [
		isExpanded,
		selectedPlaylistId,
		targetPlaylists,
		availablePlaylists,
		matchingNav,
		availableNav,
	]);

	// Restore focus to the originating column on detail close. Falls back to
	// the other non-empty column when the origin column is empty.
	const prevSelectedIdRef = useRef<string | null>(null);
	useEffect(() => {
		const prev = prevSelectedIdRef.current;
		prevSelectedIdRef.current = selectedPlaylistId;
		if (!prev || selectedPlaylistId) return;

		const origin = detailOriginColumnRef.current;
		detailOriginColumnRef.current = null;

		const restore = (column: PlaylistColumn) => {
			if (column === "matching" && targetPlaylists.length > 0) {
				matchingNav.focusFocusedItem({ mode: "keyboard", scroll: false });
				return true;
			}
			if (column === "available" && availablePlaylists.length > 0) {
				availableNav.focusFocusedItem({ mode: "keyboard", scroll: false });
				return true;
			}
			return false;
		};

		if (origin && restore(origin)) return;
		if (restore("matching")) return;
		restore("available");
	}, [
		selectedPlaylistId,
		matchingNav,
		availableNav,
		targetPlaylists.length,
		availablePlaylists.length,
	]);

	const expandedPlaylist = useMemo(
		() => data?.playlists.find((p) => p.id === selectedPlaylistId) ?? null,
		[data?.playlists, selectedPlaylistId],
	);

	if (!data) {
		return (
			<div className="mx-auto max-w-5xl">
				<PlaylistsHeader
					totalCount={null}
					searchQuery={searchQuery}
					onSearchChange={setSearchQuery}
				/>
				<div className="flex min-h-[40vh] items-center justify-center">
					<p
						className="theme-text-muted text-sm"
						style={{ fontFamily: fonts.body }}
					>
						Listening for your playlists…
					</p>
				</div>
			</div>
		);
	}

	if (data.playlists.length === 0) {
		return (
			<div className="mx-auto max-w-5xl">
				<PlaylistsHeader
					totalCount={0}
					searchQuery={searchQuery}
					onSearchChange={setSearchQuery}
				/>
				<div className="flex min-h-[40vh] items-start pt-12">
					<div className="max-w-md">
						<h2
							className="theme-text mb-4 text-3xl font-extralight italic leading-tight text-balance"
							style={{ fontFamily: fonts.display }}
						>
							No playlists yet.
						</h2>
						<p
							className="theme-text-muted text-sm leading-relaxed text-pretty"
							style={{ fontFamily: fonts.body }}
						>
							{extensionStatus === "unavailable"
								? "Install the hearted. extension and your library will find its way here."
								: "Sync your library through the extension, your playlists will be waiting."}
						</p>
					</div>
				</div>
			</div>
		);
	}

	const handleToggleTarget = (id: string, isTarget: boolean) => {
		void toggleTarget(id, isTarget);
	};

	return (
		<div className="relative mx-auto min-h-[600px] max-w-5xl">
			<PlaylistsHeader
				totalCount={data.playlists.length}
				searchQuery={searchQuery}
				onSearchChange={setSearchQuery}
			/>
			<div className="grid grid-cols-[1fr_280px] gap-10">
				<div
					ref={expansionColumnRef}
					className={`relative ${
						selectedPlaylistId && !startRect ? "min-h-[calc(100vh-12rem)]" : ""
					}`}
				>
					<ActivePlaylistsPanel
						playlists={targetPlaylists}
						onSelectPlaylist={handleExpandFromColumn}
						onRemove={(id) => handleToggleTarget(id, false)}
						isExpanded={isExpanded}
						closingToPlaylistId={closingToPlaylistId}
						selectedPlaylistId={selectedPlaylistId}
						searchQuery={isSearching ? searchQuery : null}
						onClearSearch={() => setSearchQuery("")}
						getItemProps={matchingNav.getItemProps}
					/>
					{expandedPlaylist && (
						<PlaylistDetailView
							theme={theme}
							playlist={expandedPlaylist}
							isTarget={targetIds.has(expandedPlaylist.id)}
							isExpanded={isExpanded}
							startRect={startRect}
							expandedRect={expandedRect}
							extensionStatus={extensionStatus}
							accountId={accountId}
							onClose={handleClose}
							onToggleTarget={handleToggleTarget}
							onMetadataChanged={markMetadataChanged}
						/>
					)}
				</div>

				<PlaylistLibrary
					playlists={availablePlaylists}
					onSelectPlaylist={handleExpandFromColumn}
					onAddPlaylist={(id) => handleToggleTarget(id, true)}
					closingToPlaylistId={closingToPlaylistId}
					getItemProps={availableNav.getItemProps}
					selectedPlaylistId={selectedPlaylistId}
					searchQuery={isSearching ? searchQuery : null}
					onClearSearch={() => setSearchQuery("")}
				/>
			</div>
		</div>
	);
}
