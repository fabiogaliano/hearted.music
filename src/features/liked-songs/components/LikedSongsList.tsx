import { CircleNotchIcon } from "@phosphor-icons/react";
import type { RefCallback } from "react";
import { useCallback } from "react";
import type { ListItemNavigationProps } from "@/lib/keyboard/types";
import { fonts } from "@/lib/theme/fonts";
import type { SearchFilter } from "../filter";
import type { LikedSong } from "../types";
import { SongCard } from "./SongCard";

interface LikedSongsListData {
	isLoading: boolean;
	filter: SearchFilter;
	displayedSongs: readonly LikedSong[];
	visibleSongs: readonly LikedSong[];
	hasMore: boolean;
	/** Active search query, or null when not searching. */
	searchQuery: string | null;
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

function EditorialNotice({
	eyebrow,
	headline,
	body,
	isLoading = false,
}: {
	eyebrow: string;
	headline: string;
	body?: string;
	isLoading?: boolean;
}) {
	return (
		<div className="flex min-h-80 flex-col items-center justify-center px-6 text-center">
			{isLoading ? (
				<CircleNotchIcon
					size={24}
					weight="regular"
					className="theme-primary mb-5 animate-spin"
					aria-hidden="true"
				/>
			) : (
				<span
					aria-hidden="true"
					className="theme-border-bg mb-5 block h-px w-8"
				/>
			)}
			<p
				className="theme-text-muted text-xs tracking-widest uppercase"
				style={{ fontFamily: fonts.body }}
			>
				{eyebrow}
			</p>
			<p
				className="theme-text mt-2 text-lg font-extralight tracking-tight"
				style={{ fontFamily: fonts.display }}
			>
				{headline}
			</p>
			{body && (
				<p
					className="theme-text-muted mt-2 max-w-sm text-sm leading-relaxed"
					style={{ fontFamily: fonts.body }}
				>
					{body}
				</p>
			)}
		</div>
	);
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
			<div className="-mx-3 px-3 pt-4">
				<EditorialNotice eyebrow="Loading" headline="One moment." isLoading />
			</div>
		);
	}

	const isLockedOnlyView = selection.isActive || data.filter === "locked";

	if (
		data.searchQuery &&
		data.visibleSongs.length === 0 &&
		(!isLockedOnlyView || !data.hasMore)
	) {
		return (
			<div className="-mx-3 px-3 pt-4">
				<EditorialNotice
					eyebrow="No matches"
					headline={`Nothing for "${data.searchQuery}".`}
					body="Try a different search or clear it to browse your library."
				/>
			</div>
		);
	}

	if (data.displayedSongs.length === 0) {
		const isAll = data.filter === "all";
		return (
			<div className="-mx-3 px-3 pt-4">
				<EditorialNotice
					eyebrow={isAll ? "Nothing yet" : `No ${data.filter}`}
					headline={isAll ? "Like a song on Spotify." : "Try another filter."}
					body={
						isAll
							? "Your liked songs will land here as soon as you tap the heart."
							: undefined
					}
				/>
			</div>
		);
	}

	return (
		<div className="-mx-3 px-3 pt-4">
			<div className="space-y-1">
				{data.visibleSongs.length === 0 && isLockedOnlyView && (
					<EditorialNotice
						eyebrow={data.hasMore ? "Searching" : "All clear"}
						headline={
							data.hasMore
								? "Finding locked songs…"
								: selection.isActive
									? "Nothing left to unlock."
									: "Nothing locked."
						}
						isLoading={data.hasMore}
					/>
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
							suppressPointerFocus={navigation.isExpanded}
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
