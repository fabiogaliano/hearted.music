import { useQuery } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { Playlist } from "@/lib/domains/library/playlists/queries";
import { scrollListElementIntoView } from "@/lib/keyboard/listScroll";
import { useListNavigation } from "@/lib/keyboard/useListNavigation";
import { useShortcut } from "@/lib/keyboard/useShortcut";
import { fonts } from "@/lib/theme/fonts";
import type { ThemeConfig } from "@/lib/theme/types";
import { ActivePlaylistsPanel } from "./components/ActivePlaylistsPanel";
import { PlaylistDetailView } from "./components/PlaylistDetailView";
import { PlaylistLibrary } from "./components/PlaylistLibrary";
import { useExtensionStatus } from "./hooks/useExtensionStatus";
import {
	buildPlaylistRouteRef,
	resolvePlaylistIdFromRouteRef,
} from "./playlistRouteRef";
import { usePlaylistExpansion } from "./hooks/usePlaylistExpansion";
import { usePlaylistSession } from "./hooks/usePlaylistSession";
import { playlistManagementQueryOptions } from "./queries";

const useIsomorphicLayoutEffect =
	typeof window !== "undefined" ? useLayoutEffect : useEffect;

interface PlaylistsScreenProps {
	theme: ThemeConfig;
	accountId: string;
	selectedPlaylistRef?: string;
}

export function PlaylistsScreen({
	theme,
	accountId,
	selectedPlaylistRef,
}: PlaylistsScreenProps) {
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

	const { targetPlaylists, availablePlaylists } = useMemo(() => {
		if (!data) return { targetPlaylists: [], availablePlaylists: [] };
		return {
			targetPlaylists: data.playlists.filter((p) => targetIds.has(p.id)),
			availablePlaylists: data.playlists.filter((p) => !targetIds.has(p.id)),
		};
	}, [data, targetIds]);

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
			<div className="flex min-h-[60vh] items-center justify-center">
				<p
					className="text-sm"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					Loading playlists…
				</p>
			</div>
		);
	}

	if (data.playlists.length === 0) {
		return (
			<div className="flex min-h-[60vh] items-center justify-center">
				<div className="text-center">
					<h2
						className="mb-3 text-2xl font-extralight"
						style={{
							fontFamily: fonts.display,
							color: theme.text,
						}}
					>
						No playlists synced yet
					</h2>
					<p
						className="max-w-sm text-sm"
						style={{
							fontFamily: fonts.body,
							color: theme.textMuted,
						}}
					>
						{extensionStatus === "unavailable"
							? "Install the hearted. extension and sync your library to see your playlists here."
							: "Sync your library through the extension to see your playlists here."}
					</p>
				</div>
			</div>
		);
	}

	const handleToggleTarget = (id: string, isTarget: boolean) => {
		void toggleTarget(id, isTarget);
	};

	return (
		<div className="relative min-h-[600px]">
			<div className="grid max-w-6xl grid-cols-[1fr_280px] gap-10">
				<ActivePlaylistsPanel
					theme={theme}
					playlists={targetPlaylists}
					onSelectPlaylist={handleExpand}
					onRemove={(id) => handleToggleTarget(id, false)}
					columnRef={expansionColumnRef}
					isExpanded={isExpanded}
					closingToPlaylistId={closingToPlaylistId}
					selectedPlaylistId={selectedPlaylistId}
				/>

				<PlaylistLibrary
					theme={theme}
					playlists={availablePlaylists}
					onSelectPlaylist={handleExpand}
					onAddPlaylist={(id) => handleToggleTarget(id, true)}
					closingToPlaylistId={closingToPlaylistId}
					getItemProps={getItemProps}
					selectedPlaylistId={selectedPlaylistId}
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
		</div>
	);
}
