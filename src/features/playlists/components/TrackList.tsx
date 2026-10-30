import { memo } from "react";
import { SpotifyPlaybackCover } from "@/features/playback/SpotifyPlaybackCover";
import {
	type SingleActivePlayback,
	useSingleActivePlayback,
} from "@/features/playback/useSingleActivePlayback";
import { useInfiniteScroll } from "@/lib/hooks/useInfiniteScroll";
import { chunkArray } from "@/lib/shared/utils/concurrency";
import { fonts } from "@/lib/theme/fonts";
import { PLAYLIST_TRACKS_PAGE_SIZE } from "../queries";
import { Cover } from "./Cover";
import type { PlaylistTrackVM } from "./types";
import "./playlist-ui.css";

interface TrackListProps {
	tracks: PlaylistTrackVM[];
	/** Total count; when it exceeds the loaded rows we show a "+ N more" tail. */
	songCount: number;
	/** More pages exist — render a scroll sentinel instead of the "+ N more" tail. */
	hasMore?: boolean;
	/** A next page is in flight (drives the sentinel's "Loading more…" copy). */
	isLoadingMore?: boolean;
	/** Called when the sentinel scrolls into view; the caller loads the next page. */
	onLoadMore?: () => void;
	/** Suppress the "No tracks yet" empty state — used in the onboarding rehearsal
	 *  where canned playlists have no tracks and the message would be noise. */
	hideEmptyState?: boolean;
	/** Drop the per-track album column — for tight contexts like the match
	 *  preview card where the extra text is noise. */
	hideAlbum?: boolean;
	/** Stagger the rows in on mount. The preview card sets this false on re-opens
	 *  so a repeated hover-sweep doesn't replay the whole ripple every time. */
	animateIn?: boolean;
	/** Opt in to an inline Spotify play button on each track's cover so a song can
	 *  be previewed without leaving the list. Off by default — only the /match
	 *  playlist flip enables it; other TrackList uses stay plain covers. */
	enableTrackPlayback?: boolean;
	/** Shared "one preview at a time" coordinator. When supplied (the /match playlist
	 *  flip), previews here and in the adjacent suggestions column stop each other.
	 *  Omitted elsewhere, where the list falls back to a local coordinator. */
	playback?: SingleActivePlayback;
}

// About one panel's height of rows. The stagger is index-based and the fill
// mode holds a row hidden until its delay ends, so rows past the first screen
// (and every infinite-scroll page) skip the enter instead of waiting i × 26ms.
const STAGGERED_ROWS = 14;

// py-2 around a 40px cover; the two text lines are shorter than the cover.
// A chunk's placeholder must match its real height or skipped chunks shift
// the panel's scroll position.
const TRACK_ROW_HEIGHT_PX = 56;

// About 25 rows ahead, so the next page usually lands before the sentinel
// reaches the panel's bottom edge.
const PREFETCH_MARGIN_PX = 1500;

/** Presentational track list with a staggered enter. Tracks come in as props so
 *  the panel stays storybook-able; real wiring loads them via a server fn and
 *  passes hasMore/onLoadMore so the list paginates on scroll. */
export function TrackList({
	tracks,
	songCount,
	hasMore = false,
	isLoadingMore = false,
	onLoadMore,
	hideEmptyState = false,
	hideAlbum = false,
	animateIn = true,
	enableTrackPlayback = false,
	playback,
}: TrackListProps) {
	const { sentinelRef } = useInfiniteScroll({
		onLoadMore: onLoadMore ?? (() => {}),
		hasMore,
		itemCount: tracks.length,
		threshold: PREFETCH_MARGIN_PX,
	});
	// One preview at a time. Prefer the coordinator shared with the suggestions
	// column when it's passed in, so playing a track pauses a suggestion's iframe and
	// vice versa; otherwise fall back to a list-local one. The hook must run
	// unconditionally (rules of hooks) even when the shared coordinator wins.
	const localPlayback = useSingleActivePlayback();
	const { activePlaybackId, activatePlayback, deactivatePlayback } =
		playback ?? localPlayback;
	if (!tracks.length) {
		if (hideEmptyState) return null;
		return (
			<p
				className="theme-text-muted text-xs leading-relaxed text-pretty"
				style={{ fontFamily: fonts.body }}
			>
				No tracks yet — this home is still waiting for its first song.
			</p>
		);
	}
	const remaining = songCount - tracks.length;
	return (
		<div className="flex flex-col">
			<div className="mb-1.5 flex items-baseline justify-between">
				<span
					className="theme-text-muted flex items-baseline gap-2.5 text-xs tracking-[0.2em] uppercase"
					style={{ fontFamily: fonts.body }}
				>
					Tracks <span className="tabular-nums">{songCount}</span>
				</span>
			</div>
			{/* One content-visibility chunk per page: far-off chunks skip style,
			    layout and paint while every row stays in the DOM for find-in-page
			    and focus. */}
			{chunkArray(tracks, PLAYLIST_TRACKS_PAGE_SIZE).map(
				(chunk, chunkIndex) => (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: a chunk is a fixed slice of the list, so its index is its identity
						key={chunkIndex}
						style={{
							contentVisibility: "auto",
							containIntrinsicHeight: `auto ${chunk.length * TRACK_ROW_HEIGHT_PX}px`,
						}}
					>
						{chunk.map((track, chunkRow) => {
							const i = chunkIndex * PLAYLIST_TRACKS_PAGE_SIZE + chunkRow;
							const rowId = `${track.position}-${track.name}`;
							return (
								<TrackRow
									key={rowId}
									track={track}
									index={i}
									rowId={rowId}
									staggered={animateIn && i < STAGGERED_ROWS}
									hideAlbum={hideAlbum}
									enableTrackPlayback={enableTrackPlayback}
									isPlaybackActive={activePlaybackId === rowId}
									onActivatePlayback={activatePlayback}
									onDeactivatePlayback={deactivatePlayback}
								/>
							);
						})}
					</div>
				),
			)}
			{/* Outside the chunks, since a skipped chunk's contents never
			    intersect; fixed height so the copy appearing moves nothing. */}
			{hasMore ? (
				<div
					ref={sentinelRef}
					className="theme-text-muted flex h-10 items-center justify-center text-xs"
					style={{ fontFamily: fonts.body }}
				>
					{isLoadingMore ? "Loading more…" : null}
				</div>
			) : (
				remaining > 0 && (
					<div className="flex items-center gap-3.5 px-2.5 py-2 opacity-60">
						<span className="w-[18px] flex-none" />
						<span
							className="theme-text-muted text-xs"
							style={{ fontFamily: fonts.body }}
						>
							+ {remaining} more…
						</span>
					</div>
				)
			)}
		</div>
	);
}

// Memoised so a page append renders only the new rows: track objects keep
// their identity across appends (pages are reused as-is) and every other prop
// is a primitive or a stable callback.
const TrackRow = memo(function TrackRow({
	track,
	index,
	rowId,
	staggered,
	hideAlbum,
	enableTrackPlayback,
	isPlaybackActive,
	onActivatePlayback,
	onDeactivatePlayback,
}: {
	track: PlaylistTrackVM;
	index: number;
	rowId: string;
	staggered: boolean;
	hideAlbum: boolean;
	enableTrackPlayback: boolean;
	isPlaybackActive: boolean;
	onActivatePlayback: (playbackId: string) => void;
	onDeactivatePlayback: () => void;
}) {
	return (
		<div
			// The evolved SongRow from vision/StudioTracklist.stories.tsx, which
			// is this exact component: hairline out, radius in, ~8px/10px
			// padding, transparent at rest. The hover is gated on
			// enableTrackPlayback — with playback off the row is inert, and a
			// fill that follows the pointer onto something unclickable is a lie.
			// Gated on the list-level flag, not per-track spotifyId, so one list
			// doesn't have some rows that respond and some that don't.
			// TRACK_ROW_HEIGHT_PX mirrors this row's height; change both together.
			className={`squircle flex items-center gap-3.5 rounded-[10px] px-2.5 py-2 ${
				enableTrackPlayback
					? "surface-raised-hover transition-[background-color] duration-150 ease-out"
					: ""
			} ${staggered ? "xpl-track-enter" : ""}`}
			style={staggered ? { animationDelay: `${index * 26}ms` } : undefined}
		>
			<span
				className="theme-text-muted w-[18px] flex-none text-right text-xs tabular-nums"
				style={{ fontFamily: fonts.body }}
			>
				{index + 1}
			</span>
			{enableTrackPlayback && track.spotifyId ? (
				<SpotifyPlaybackCover
					playbackId={rowId}
					spotifyTrackId={track.spotifyId}
					imageUrl={track.imageUrl}
					imageAlt={track.name}
					playLabel={`Play preview for ${track.name}`}
					size={40}
					isPlaybackActive={isPlaybackActive}
					onActivate={onActivatePlayback}
					onDeactivate={onDeactivatePlayback}
					playButtonSize={26}
					playIconSize={12}
					closeIconSize={12}
					closeInset="0.125rem"
					className="flex-none"
				/>
			) : (
				<Cover src={track.imageUrl} size={40} className="flex-none" />
			)}
			<div className="min-w-0 flex-1">
				<div
					className="theme-text truncate text-sm leading-tight"
					style={{ fontFamily: fonts.body }}
				>
					{track.name}
				</div>
				<div
					className="theme-text-muted truncate text-xs"
					style={{ fontFamily: fonts.body }}
				>
					{track.artists.join(", ")}
				</div>
			</div>
			{!hideAlbum && track.albumName && (
				<span
					className="theme-text-muted max-w-[34%] flex-none truncate text-right text-xs"
					style={{ fontFamily: fonts.body }}
				>
					{track.albumName}
				</span>
			)}
		</div>
	);
});
