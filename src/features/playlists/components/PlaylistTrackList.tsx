import { useQuery } from "@tanstack/react-query";
import { fonts } from "@/lib/theme/fonts";
import { playlistTrackPreviewQueryOptions } from "../queries";

interface PlaylistTrackListProps {
	playlistId: string | null;
	isExpanded: boolean;
}

export function PlaylistTrackList({
	playlistId,
	isExpanded,
}: PlaylistTrackListProps) {
	const { data: tracks } = useQuery(
		playlistTrackPreviewQueryOptions(playlistId),
	);

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
			{!tracks || tracks.length === 0 ? (
				<p
					className="theme-text-muted py-4 text-sm"
					style={{ fontFamily: fonts.body }}
				>
					{playlistId
						? "No track data available for this playlist yet."
						: "Select a playlist to see tracks."}
				</p>
			) : (
				tracks.slice(0, 12).map((track, index) => (
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
