import { useInfiniteScroll } from "@/lib/hooks/useInfiniteScroll";
import { fonts } from "@/lib/theme/fonts";
import { Cover } from "./Cover";
import type { PlaylistTrackVM } from "./types";
import "./playlist-explorations.css";

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
}: TrackListProps) {
	const { sentinelRef } = useInfiniteScroll({
		onLoadMore: onLoadMore ?? (() => {}),
		hasMore,
	});
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
			{tracks.map((track, i) => (
				<div
					key={`${track.position}-${track.name}`}
					className="theme-border-color xpl-track-enter flex items-center gap-3.5 border-b py-2.5 last:border-b-0"
					style={{ animationDelay: `${i * 26}ms` }}
				>
					<span
						className="theme-text-muted w-[18px] flex-none text-right text-xs tabular-nums"
						style={{ fontFamily: fonts.body }}
					>
						{i + 1}
					</span>
					<Cover src={track.imageUrl} size={40} className="flex-none" />
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
			))}
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
