import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Playlist } from "@/lib/domains/library/playlists/queries";
import { useListNavigation } from "@/lib/keyboard/useListNavigation";
import { useShortcut } from "@/lib/keyboard/useShortcut";
import type { ThemeConfig } from "@/lib/theme/types";
import { fonts } from "@/lib/theme/fonts";
import { playlistManagementQueryOptions } from "./queries";
import { usePlaylistExpansion } from "./hooks/usePlaylistExpansion";
import { usePlaylistSession } from "./hooks/usePlaylistSession";
import { useExtensionStatus } from "./hooks/useExtensionStatus";
import { ActivePlaylistsPanel } from "./components/ActivePlaylistsPanel";
import { PlaylistLibrary } from "./components/PlaylistLibrary";
import { PlaylistDetailView } from "./components/PlaylistDetailView";

const useIsomorphicLayoutEffect =
	typeof window !== "undefined" ? useLayoutEffect : useEffect;

interface PlaylistsScreenProps {
	theme: ThemeConfig;
	accountId: string;
}

export function PlaylistsScreen({ theme, accountId }: PlaylistsScreenProps) {
	const { data } = useQuery(playlistManagementQueryOptions(accountId));
	const { extensionStatus } = useExtensionStatus();
	const { optimisticTargets, toggleTarget, markMetadataChanged } =
		usePlaylistSession(accountId);

	const {
		selectedPlaylistId,
		isExpanded,
		startRect,
		expandedRect,
		rightColumnRef,
		handleExpand,
		handleClose,
		closingToPlaylistId,
	} = usePlaylistExpansion();

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
		syncFocusedIndex,
		getFocusedElement,
		focusFocusedItem,
		getItemProps,
	} = useListNavigation<Playlist>({
		items: availablePlaylists,
		scope: "playlists-list",
		enabled: !isExpanded && availablePlaylists.length > 0,
		onSelect: (playlist, _index, element) => {
			if (element) {
				handleExpand(playlist.id, {
					currentTarget: element,
				} as React.MouseEvent<HTMLDivElement>);
			}
		},
		getId: (playlist) => playlist.id,
		scrollBlock: "center",
	});

	useShortcut({
		key: "enter",
		handler: () => {
			if (focusedIndex >= 0 && focusedIndex < availablePlaylists.length) {
				const playlist = availablePlaylists[focusedIndex];
				const element = getFocusedElement();
				if (element) {
					handleExpand(playlist.id, {
						currentTarget: element,
					} as React.MouseEvent<HTMLDivElement>);
				}
			}
		},
		description: "Open playlist details",
		scope: "playlists-list",
		category: "actions",
		enabled: !isExpanded && focusedIndex >= 0,
	});

	useIsomorphicLayoutEffect(() => {
		if (selectedPlaylistId) {
			const index = availablePlaylists.findIndex(
				(p) => p.id === selectedPlaylistId,
			);
			if (index >= 0) {
				syncFocusedIndex(index, { focus: false, scroll: true });
			}
		}
	}, [selectedPlaylistId, availablePlaylists, syncFocusedIndex]);

	const prevSelectedIdRef = useRef<string | null>(null);
	useEffect(() => {
		const prev = prevSelectedIdRef.current;
		prevSelectedIdRef.current = selectedPlaylistId;
		if (prev && !selectedPlaylistId) {
			focusFocusedItem({ engage: true });
		}
	}, [selectedPlaylistId, focusFocusedItem]);

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

	const expandedPlaylist = data.playlists.find(
		(p) => p.id === selectedPlaylistId,
	);

	const handleToggleTarget = (id: string, isTarget: boolean) => {
		void toggleTarget(id, isTarget);
	};

	return (
		<div className="relative min-h-[600px]">
			<div className="grid max-w-6xl grid-cols-[280px_1fr] gap-10">
				<ActivePlaylistsPanel
					theme={theme}
					playlists={targetPlaylists}
					onRemove={(id) => handleToggleTarget(id, false)}
					closingToPlaylistId={closingToPlaylistId}
				/>

				<PlaylistLibrary
					theme={theme}
					playlists={availablePlaylists}
					onSelectPlaylist={handleExpand}
					onAddPlaylist={(id) => handleToggleTarget(id, true)}
					columnRef={rightColumnRef}
					isExpanded={isExpanded}
					closingToPlaylistId={closingToPlaylistId}
					getItemProps={getItemProps}
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
