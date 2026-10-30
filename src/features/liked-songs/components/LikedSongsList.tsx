import { CircleNotchIcon } from "@phosphor-icons/react";
import type { RefCallback } from "react";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/Button";
import { LIKED_SONGS_PAGE_SIZE } from "@/lib/domains/library/liked-songs/constants";
import type { ListItemNavigationProps } from "@/lib/keyboard/types";
import { fonts } from "@/lib/theme/fonts";
import type { SearchFilter } from "../filter";
import type { LikedSongsLoadState } from "../hooks/useLikedSongsCollection";
import type { LikedSong } from "../types";
import { chunkAroundOrigin } from "./list-chunks";
import { SongCard } from "./SongCard";

interface LikedSongsListData {
	loadState: LikedSongsLoadState;
	retry: () => void;
	filter: SearchFilter;
	displayedSongs: readonly LikedSong[];
	visibleSongs: readonly LikedSong[];
	hasMore: boolean;
	/** A next page is in flight. */
	isLoadingMore: boolean;
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

// Rows are a fixed 72px (48px art + py-3, single-line text) with space-y-0.5's
// 2px after every row but a chunk's last. A chunk's placeholder height has to
// match its real height or skipped chunks shift scroll position and
// scrollIntoView centring lands off.
const ROW_HEIGHT_PX = 72;
const ROW_GAP_PX = 2;

// One content-visibility chunk per page of rows: the browser skips style,
// layout and paint for chunks far off-screen while every row stays in the DOM
// (find-in-page, focus and the accessibility tree keep working). Per-row
// skipping is slower than none when scrolling, since rows unlock one by one.
function chunkStyle(rowCount: number) {
	return {
		contentVisibility: "auto",
		containIntrinsicHeight: `auto ${rowCount * (ROW_HEIGHT_PX + ROW_GAP_PX) - ROW_GAP_PX}px`,
	} as const;
}

// The row chunk boundaries are measured from: the first row the list rendered
// with, until it leaves the list (a filter change, an unlike), when the
// current first row takes over.
export function useChunkOriginIndex(
	songs: readonly { track: { id: string } }[],
	indexById: ReadonlyMap<string, number>,
): number {
	const [originId, setOriginId] = useState(songs[0]?.track.id ?? null);
	const originIndex = originId === null ? undefined : indexById.get(originId);
	if (originIndex !== undefined) return originIndex;
	const firstId = songs[0]?.track.id ?? null;
	if (firstId !== originId) setOriginId(firstId);
	return 0;
}

function EditorialNotice({
	eyebrow,
	headline,
	body,
	isLoading = false,
	action,
}: {
	eyebrow: string;
	headline: string;
	body?: string;
	isLoading?: boolean;
	action?: { label: string; onClick: () => void };
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
			{action && (
				<Button
					variant="link"
					onClick={action.onClick}
					className="mt-4"
					style={{ fontFamily: fonts.body }}
				>
					{action.label}
				</Button>
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
	const chunkOriginIndex = useChunkOriginIndex(
		data.visibleSongs,
		navigation.navIndexBySongId,
	);

	if (data.loadState === "loading") {
		return (
			<div className="px-2 pt-2">
				<EditorialNotice eyebrow="Loading" headline="One moment." isLoading />
			</div>
		);
	}

	if (data.loadState === "error") {
		return (
			<div className="px-2 pt-2" role="alert">
				<EditorialNotice
					eyebrow="Couldn't load"
					headline="Your library didn't come through."
					body="Your songs are safe. This is on our side."
					action={{ label: "Try again", onClick: data.retry }}
				/>
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
			<div className="px-2 pt-2">
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
			<div className="px-2 pt-2">
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
		<div className="px-2 pt-2">
			<div className="space-y-0.5">
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
				{chunkAroundOrigin(
					data.visibleSongs,
					chunkOriginIndex,
					LIKED_SONGS_PAGE_SIZE,
				).map((chunk) => (
					<div
						key={chunk.key}
						className="space-y-0.5"
						style={chunkStyle(chunk.items.length)}
					>
						{chunk.items.map((song) => {
							const isHeroSong =
								walkthrough.isActive &&
								walkthrough.songId !== null &&
								song.track.id === walkthrough.songId;
							// During the walkthrough only the chosen demo song stays interactive —
							// the rest dim and go inert (isEnabled=false) so attention and the click
							// land on the one the user picked. Outside the walkthrough, or before a
							// song is chosen, every song stays enabled.
							const isSongEnabled =
								!walkthrough.isActive ||
								walkthrough.songId === null ||
								isHeroSong;
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
									isWalkthrough={walkthrough.isActive}
									isWalkthroughHighlight={
										!!isHeroSong && !navigation.isExpanded
									}
								/>
							);
						})}
					</div>
				))}

				{/* Outside every chunk: a skipped chunk's contents never intersect, so
				    a sentinel inside one would stop firing. Fixed height so the copy
				    appearing while a page loads moves nothing. */}
				{data.hasMore && data.visibleSongs.length > 0 && (
					<div
						ref={navigation.sentinelRef}
						className="flex h-20 items-center justify-center"
					>
						{data.isLoadingMore && (
							<span
								className="theme-text-muted text-xs tracking-widest uppercase"
								style={{ fontFamily: fonts.body }}
							>
								Loading more…
							</span>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
