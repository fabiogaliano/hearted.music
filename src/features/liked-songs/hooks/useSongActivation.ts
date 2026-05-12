import { useCallback, useMemo } from "react";
import type {
	ListNavigationSource,
	ListScrollBlock,
} from "@/lib/keyboard/types";
import type { LikedSong } from "../types";

export interface PendingSelectionFocus {
	songId: string;
	mode: "keyboard" | "pointer";
	scrollBlock: ListScrollBlock;
}

interface SongActivationOptions {
	song: LikedSong;
	element: HTMLElement | null;
	routeSource: Extract<ListNavigationSource, "keyboard" | "pointer">;
	selectionFocusMode: PendingSelectionFocus["mode"];
}

interface UseSongActivationOptions {
	displayedSongs: readonly LikedSong[];
	showSelectionUI: boolean;
	selectionMode: boolean;
	enterSelectionMode: () => void;
	toggleSongSelection: (songId: string) => void;
	handleExpand: (song: LikedSong, element: HTMLElement) => void;
	prefetchAdjacentSuggestions: (songId: string) => void;
	queueSelectionFocus: (focus: PendingSelectionFocus) => void;
	markRouteSelectionSource: (source: ListNavigationSource) => void;
}

export function useSongActivation({
	displayedSongs,
	showSelectionUI,
	selectionMode,
	enterSelectionMode,
	toggleSongSelection,
	handleExpand,
	prefetchAdjacentSuggestions,
	queueSelectionFocus,
	markRouteSelectionSource,
}: UseSongActivationOptions) {
	const songById = useMemo(() => {
		const map = new Map<string, LikedSong>();
		for (const song of displayedSongs) {
			map.set(song.track.id, song);
		}
		return map;
	}, [displayedSongs]);

	const activateSong = useCallback(
		({
			song,
			element,
			routeSource,
			selectionFocusMode,
		}: SongActivationOptions) => {
			if (song.displayState === "locked" && showSelectionUI) {
				if (!selectionMode) {
					queueSelectionFocus({
						songId: song.track.id,
						mode: selectionFocusMode,
						scrollBlock: "start",
					});
					enterSelectionMode();
				}
				toggleSongSelection(song.track.id);
				return;
			}

			if (!element) return;
			markRouteSelectionSource(routeSource);
			handleExpand(song, element);
			prefetchAdjacentSuggestions(song.track.id);
		},
		[
			enterSelectionMode,
			handleExpand,
			markRouteSelectionSource,
			prefetchAdjacentSuggestions,
			queueSelectionFocus,
			selectionMode,
			showSelectionUI,
			toggleSongSelection,
		],
	);

	const handleCardClick = useCallback(
		(songId: string, element: HTMLElement) => {
			const song = songById.get(songId);
			if (!song) return;

			activateSong({
				song,
				element,
				routeSource: "pointer",
				selectionFocusMode: "pointer",
			});
		},
		[activateSong, songById],
	);

	return { activateSong, handleCardClick };
}
