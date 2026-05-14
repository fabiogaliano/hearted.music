import type { RefCallback } from "react";
import { useCallback } from "react";
import type { ListItemNavigationProps } from "@/lib/keyboard/types";
import { fonts } from "@/lib/theme/fonts";
import type { FilterOption } from "../queries";
import type { LikedSong } from "../types";
import { SongCard } from "./SongCard";

interface LikedSongsListData {
	isLoading: boolean;
	filter: FilterOption;
	displayedSongs: readonly LikedSong[];
	visibleSongs: readonly LikedSong[];
	hasMore: boolean;
}

interface LikedSongsListSelection {
	isActive: boolean;
	selectedSongIds: ReadonlySet<string>;
	scrollMarginTop: string | undefined;
	onToggleSelect: (songId: string) => void;
}

interface LikedSongsListNavigation {
	selectedSongId: string | null;
	closingToSongId: string | null;
	isExpanded: boolean;
	navIndexBySongId: ReadonlyMap<string, number>;
	getItemProps: (song: LikedSong, index: number) => ListItemNavigationProps;
	onCardClick: (songId: string, element: HTMLElement) => void;
	sentinelRef: RefCallback<HTMLDivElement>;
}

interface LikedSongsListWalkthrough {
	isActive: boolean;
	songId: string | null;
}

interface LikedSongsListProps {
	data: LikedSongsListData;
	selection: LikedSongsListSelection;
	navigation: LikedSongsListNavigation;
	walkthrough: LikedSongsListWalkthrough;
}

export function LikedSongsList({
	data,
	selection,
	navigation,
	walkthrough,
}: LikedSongsListProps) {
	const noopItemRef = useCallback(() => {}, []);

	if (data.isLoading) {
		return (
			<div className="theme-border-color -mx-3 border-t px-3 pt-6">
				<div className="py-12 text-center">
					<p
						className="theme-text-muted text-sm"
						style={{ fontFamily: fonts.body }}
					>
						Loading your liked songs…
					</p>
				</div>
			</div>
		);
	}

	if (data.displayedSongs.length === 0) {
		return (
			<div className="theme-border-color -mx-3 border-t px-3 pt-6">
				<div className="py-12 text-center">
					<p
						className="theme-text-muted text-sm"
						style={{ fontFamily: fonts.body }}
					>
						{data.filter === "all"
							? "No liked songs yet. Like songs on Spotify to see them here."
							: `No ${data.filter} songs.`}
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="theme-border-color -mx-3 border-t px-3 pt-6">
			<div className="space-y-1">
				{data.visibleSongs.length === 0 && selection.isActive && (
					<div className="py-12 text-center">
						<p
							className="theme-text-muted text-sm"
							style={{ fontFamily: fonts.body }}
						>
							{data.hasMore
								? "Finding locked songs..."
								: "No locked songs available to unlock."}
						</p>
					</div>
				)}
				{data.visibleSongs.map((song) => {
					const isDemoSong =
						walkthrough.isActive &&
						walkthrough.songId !== null &&
						song.track.id === walkthrough.songId;
					const isSongEnabled = !walkthrough.isActive || isDemoSong;
					const navIndex = isSongEnabled
						? (navigation.navIndexBySongId.get(song.track.id) ?? -1)
						: -1;
					const itemProps =
						navIndex >= 0 ? navigation.getItemProps(song, navIndex) : null;
					return (
						<SongCard
							key={song.track.id}
							song={song}
							albumArtUrl={song.track.image_url ?? undefined}
							isSelected={navigation.selectedSongId === song.track.id}
							isFocused={itemProps?.["data-focused"] ?? false}
							itemRef={itemProps?.ref ?? noopItemRef}
							tabIndex={itemProps?.tabIndex ?? -1}
							dataFocused={itemProps?.["data-focused"] ?? false}
							navEngaged={itemProps?.["data-nav-engaged"] ?? false}
							dataTabFocused={itemProps?.["data-tab-focused"] ?? false}
							onPointerDown={itemProps?.onPointerDown}
							onFocus={itemProps?.onFocus}
							onBlur={itemProps?.onBlur}
							onClickSong={navigation.onCardClick}
							isAnimatingTo={navigation.closingToSongId === song.track.id}
							selectionMode={selection.isActive}
							isChecked={selection.selectedSongIds.has(song.track.id)}
							onToggleSelect={selection.onToggleSelect}
							scrollMarginTop={selection.scrollMarginTop}
							isEnabled={isSongEnabled}
							isWalkthroughHighlight={!!isDemoSong && !navigation.isExpanded}
							hideLockedBadge={walkthrough.isActive}
						/>
					);
				})}

				{data.hasMore && data.visibleSongs.length > 0 && (
					<div
						ref={navigation.sentinelRef}
						className="flex items-center justify-center py-8"
					>
						<span
							className="theme-text-muted text-xs tracking-widest uppercase"
							style={{ fontFamily: fonts.body }}
						>
							Loading more…
						</span>
					</div>
				)}
			</div>
		</div>
	);
}
