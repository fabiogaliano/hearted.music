import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Playlist } from "@/lib/domains/library/playlists/queries";
import { scrollListElementIntoView } from "@/lib/keyboard/listScroll";
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

const useIsomorphicLayoutEffect =
	typeof window !== "undefined" ? useLayoutEffect : useEffect;

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

	const {
		focusedIndex,
		lastCursorChange,
		syncFocusedIndex,
		getFocusedElement,
		getElementAtIndex,
		focusFocusedItem,
		getItemProps,
	} = useListNavigation<Playlist>({
		items: availablePlaylists,
		scope: "playlists-list",
		enabled: !isExpanded && availablePlaylists.length > 0,
		onSelect: (playlist, _index, element) => {
			if (element) {
				handleExpand(playlist.id, element);
			}
		},
		getId: (playlist) => playlist.id,
		scrollBlock: "center",
		autoScroll: false,
	});

	// Source-aware scroll: keyboard → center, pointer → nearest
	useIsomorphicLayoutEffect(() => {
		if (!lastCursorChange) return;

		const element = getElementAtIndex(lastCursorChange.index);
		if (!element) return;

		const block = lastCursorChange.source === "pointer" ? "nearest" : "center";
		scrollListElementIntoView(element, block);
	}, [lastCursorChange, getElementAtIndex]);

	useShortcut({
		key: "enter",
		handler: () => {
			if (focusedIndex >= 0 && focusedIndex < availablePlaylists.length) {
				const playlist = availablePlaylists[focusedIndex];
				const element = getFocusedElement();
				if (element) {
					handleExpand(playlist.id, element);
				}
			}
		},
		description: "Open playlist details",
		scope: "playlists-list",
		category: "actions",
		enabled: !isExpanded && focusedIndex >= 0,
	});

	// Sync cursor with route-backed selected playlist
	useIsomorphicLayoutEffect(() => {
		if (selectedPlaylistId) {
			const index = availablePlaylists.findIndex(
				(p) => p.id === selectedPlaylistId,
			);
			if (index >= 0) {
				syncFocusedIndex(index, {
					focus: false,
					scroll: true,
					scrollBlock: "center",
					source: "url",
				});
			}
		}
	}, [selectedPlaylistId, availablePlaylists, syncFocusedIndex]);

	// Restore focus to Available list when detail panel closes
	const prevSelectedIdRef = useRef<string | null>(null);
	useEffect(() => {
		const prev = prevSelectedIdRef.current;
		prevSelectedIdRef.current = selectedPlaylistId;
		if (prev && !selectedPlaylistId) {
			focusFocusedItem({ mode: "keyboard" });
		}
	}, [selectedPlaylistId, focusFocusedItem]);

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
				<div ref={expansionColumnRef} className="relative">
					<ActivePlaylistsPanel
						playlists={targetPlaylists}
						onSelectPlaylist={handleExpand}
						onRemove={(id) => handleToggleTarget(id, false)}
						isExpanded={isExpanded}
						closingToPlaylistId={closingToPlaylistId}
						selectedPlaylistId={selectedPlaylistId}
						searchQuery={isSearching ? searchQuery : null}
						onClearSearch={() => setSearchQuery("")}
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
					onSelectPlaylist={handleExpand}
					onAddPlaylist={(id) => handleToggleTarget(id, true)}
					closingToPlaylistId={closingToPlaylistId}
					getItemProps={getItemProps}
					selectedPlaylistId={selectedPlaylistId}
					searchQuery={isSearching ? searchQuery : null}
					onClearSearch={() => setSearchQuery("")}
				/>
			</div>
		</div>
	);
}
