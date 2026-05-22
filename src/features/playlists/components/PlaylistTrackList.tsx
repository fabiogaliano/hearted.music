import { useInfiniteQuery } from "@tanstack/react-query";
import { AlbumPlaceholder } from "@/components/ui/AlbumPlaceholder";
import { useInfiniteScroll } from "@/lib/hooks/useInfiniteScroll";
import type { PlaylistTrack } from "@/lib/server/playlists.functions";
import { fonts } from "@/lib/theme/fonts";
import { playlistTracksInfiniteQueryOptions } from "../queries";

type TrackListState =
	| { kind: "noSelection" }
	| { kind: "loading" }
	| { kind: "error" }
	| { kind: "empty" }
	| { kind: "ready"; tracks: PlaylistTrack[] };

const TRACK_LIST_MESSAGES: Record<
	Exclude<TrackListState["kind"], "ready">,
	string
> = {
	noSelection: "Select a playlist to see tracks.",
	loading: "Loading tracks…",
	error: "Couldn’t load tracks. Try again.",
	empty: "No track data available for this playlist yet.",
};

// Disabled queries are pending-but-not-loading in React Query v5, so the
// noSelection check must precede isLoading to avoid flashing "Loading…" when
// nothing is selected.
function getTrackListState({
	playlistId,
	isLoading,
	isError,
	tracks,
}: {
	playlistId: string | null;
	isLoading: boolean;
	isError: boolean;
	tracks: PlaylistTrack[];
}): TrackListState {
	if (playlistId === null) return { kind: "noSelection" };
	if (isLoading) return { kind: "loading" };
	if (isError) return { kind: "error" };
	if (tracks.length === 0) return { kind: "empty" };
	return { kind: "ready", tracks };
}

interface PlaylistTrackListProps {
	playlistId: string | null;
	isExpanded: boolean;
	totalTrackCount?: number | null;
}

export function PlaylistTrackList({
	playlistId,
	isExpanded,
	totalTrackCount = null,
}: PlaylistTrackListProps) {
	const {
		data,
		isLoading,
		isError,
		fetchNextPage,
		hasNextPage,
		isFetchingNextPage,
	} = useInfiniteQuery(playlistTracksInfiniteQueryOptions(playlistId));

	const tracks = data?.pages.flatMap((page) => page.tracks) ?? [];
	const state = getTrackListState({ playlistId, isLoading, isError, tracks });

	const { sentinelRef } = useInfiniteScroll({
		onLoadMore: () => {
			if (hasNextPage && !isFetchingNextPage) fetchNextPage();
		},
		hasMore: Boolean(hasNextPage),
	});

	return (
		<div
			data-playlist-panel
			className="space-y-1 pb-12"
			style={{
				opacity: isExpanded ? 1 : 0,
				transition: isExpanded
					? "opacity 250ms var(--ease-out-expo) 150ms"
					: "opacity 150ms var(--ease-out-expo)",
			}}
		>
			<div className="mb-5 flex items-baseline gap-3">
				<h3
					className="theme-text-muted text-xs tracking-widest uppercase"
					style={{ fontFamily: fonts.body }}
				>
					Tracks
				</h3>
				{totalTrackCount != null && totalTrackCount > 0 && (
					<span
						className="theme-text-muted text-xs tabular-nums opacity-70"
						style={{ fontFamily: fonts.body }}
					>
						{totalTrackCount}
					</span>
				)}
			</div>
			{state.kind !== "ready" ? (
				<p
					className="theme-text-muted py-4 text-sm"
					style={{ fontFamily: fonts.body }}
				>
					{TRACK_LIST_MESSAGES[state.kind]}
				</p>
			) : (
				<>
					<ul
						className="flex flex-col"
						aria-label={`${state.tracks.length} tracks`}
					>
						{state.tracks.map((track, index) => {
							// Cap stagger so longer lists don't crawl. 20ms × 8 = 160ms
							// total before the rest enter together, which keeps perceived
							// responsiveness even when 100+ tracks load.
							const staggerMs = Math.min(index, 8) * 20;
							const artistLine =
								(track.artists[0] ?? "Unknown Artist") +
								(track.albumName ? ` · ${track.albumName}` : "");
							return (
								<li
									key={track.songId}
									className="theme-row-hover group -mx-3 flex items-center gap-4 px-3 py-3"
									style={{
										animation: `playlist-track-enter 200ms var(--ease-out-expo) ${staggerMs}ms both`,
									}}
								>
									<span
										className="theme-text-muted w-7 flex-shrink-0 text-right text-xs tabular-nums opacity-70"
										style={{ fontFamily: fonts.body }}
										aria-hidden="true"
									>
										{track.position + 1}
									</span>
									<div className="image-outline relative size-10 flex-shrink-0 overflow-hidden">
										{track.imageUrl ? (
											<img
												src={track.imageUrl}
												alt=""
												className="h-full w-full object-cover"
											/>
										) : (
											<AlbumPlaceholder />
										)}
									</div>
									<div className="min-w-0 flex-1">
										<p
											className="theme-text truncate text-sm"
											style={{ fontFamily: fonts.body }}
										>
											{track.name}
										</p>
										<p
											className="theme-text-muted truncate text-xs"
											style={{ fontFamily: fonts.body }}
										>
											{artistLine}
										</p>
									</div>
								</li>
							);
						})}
					</ul>
					{hasNextPage ? (
						<div
							ref={sentinelRef}
							data-playlist-tracks-sentinel
							className="theme-text-muted py-4 text-center text-xs"
							style={{ fontFamily: fonts.body }}
						>
							{isFetchingNextPage ? "Loading more…" : null}
						</div>
					) : null}
				</>
			)}
		</div>
	);
}
