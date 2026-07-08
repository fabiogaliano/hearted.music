import { SpotifyPlaybackCover } from "@/features/playback/SpotifyPlaybackCover";
import {
	type SingleActivePlayback,
	useSingleActivePlayback,
} from "@/features/playback/useSingleActivePlayback";
import { useInfiniteScroll } from "@/lib/hooks/useInfiniteScroll";
import { fonts } from "@/lib/theme/fonts";
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
			{tracks.map((track, i) => {
				const rowId = `${track.position}-${track.name}`;
				return (
					<div
						key={rowId}
						className={`theme-border-color flex items-center gap-3.5 border-b py-2.5 last:border-b-0 ${
							animateIn ? "xpl-track-enter" : ""
						}`}
						style={animateIn ? { animationDelay: `${i * 26}ms` } : undefined}
					>
						<span
							className="theme-text-muted w-[18px] flex-none text-right text-xs tabular-nums"
							style={{ fontFamily: fonts.body }}
						>
							{i + 1}
						</span>
						{enableTrackPlayback && track.spotifyId ? (
							<SpotifyPlaybackCover
								playbackId={rowId}
								spotifyTrackId={track.spotifyId}
								imageUrl={track.imageUrl}
								imageAlt={track.name}
								playLabel={`Play preview for ${track.name}`}
								size={40}
								isPlaybackActive={activePlaybackId === rowId}
								onActivate={activatePlayback}
								onDeactivate={deactivatePlayback}
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
			})}
			{hasMore ? (
				<div
					ref={sentinelRef}
					className="theme-text-muted py-3 text-center text-xs"
					style={{ fontFamily: fonts.body }}
				>
					{isLoadingMore ? "Loading more…" : null}
				</div>
			) : (
				remaining > 0 && (
					<div className="theme-border-color flex items-center gap-3.5 border-b py-2.5 opacity-60 last:border-b-0">
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
