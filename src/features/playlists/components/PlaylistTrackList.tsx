import { useQuery } from "@tanstack/react-query";
import type { PlaylistTrackPreview } from "@/lib/server/playlists.functions";
import { fonts } from "@/lib/theme/fonts";
import { playlistTrackPreviewQueryOptions } from "../queries";

type TrackListState =
	| { kind: "noSelection" }
	| { kind: "loading" }
	| { kind: "error" }
	| { kind: "empty" }
	| { kind: "ready"; tracks: PlaylistTrackPreview[] };

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
	tracks: PlaylistTrackPreview[] | undefined;
}): TrackListState {
	if (playlistId === null) return { kind: "noSelection" };
	if (isLoading) return { kind: "loading" };
	if (isError) return { kind: "error" };
	const list = tracks ?? [];
	if (list.length === 0) return { kind: "empty" };
	return { kind: "ready", tracks: list };
}

interface PlaylistTrackListProps {
	playlistId: string | null;
	isExpanded: boolean;
}

export function PlaylistTrackList({
	playlistId,
	isExpanded,
}: PlaylistTrackListProps) {
	const {
		data: tracks,
		isLoading,
		isError,
	} = useQuery(playlistTrackPreviewQueryOptions(playlistId));

	const state = getTrackListState({ playlistId, isLoading, isError, tracks });

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
			<div className="theme-border-color mb-4 flex items-center justify-between border-b pb-3">
				<h3
					className="theme-text-muted text-xs tracking-widest uppercase"
					style={{ fontFamily: fonts.body }}
				>
					Tracks
				</h3>
			</div>
			{state.kind !== "ready" ? (
				<p
					className="theme-text-muted py-4 text-sm"
					style={{ fontFamily: fonts.body }}
				>
					{TRACK_LIST_MESSAGES[state.kind]}
				</p>
			) : (
				state.tracks.slice(0, 12).map((track, index) => (
					<div
						key={track.songId}
						className="theme-border-color theme-hover-surface group flex items-center gap-4 border-b py-3 transition-colors duration-150 ease-out"
						style={{
							animation: `playlist-track-enter 200ms var(--ease-out-expo) ${index * 40}ms both`,
						}}
					>
						<span
							className="theme-text-muted w-6 text-right text-xs tabular-nums"
							style={{ fontFamily: fonts.body }}
						>
							{track.position + 1}
						</span>
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
								{track.artists[0] ?? "Unknown Artist"}
								{track.albumName ? ` · ${track.albumName}` : ""}
							</p>
						</div>
					</div>
				))
			)}
		</div>
	);
}
