import { useQuery } from "@tanstack/react-query";
import type { ThemeConfig } from "@/lib/theme/types";
import { fonts } from "@/lib/theme/fonts";
import { playlistTrackPreviewQueryOptions } from "../queries";

interface PlaylistTrackListProps {
	theme: ThemeConfig;
	playlistId: string | null;
	isExpanded: boolean;
}

export function PlaylistTrackList({
	theme,
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
					? "opacity 250ms cubic-bezier(0.23, 1, 0.32, 1) 150ms"
					: "opacity 150ms cubic-bezier(0.23, 1, 0.32, 1)",
			}}
		>
			<div
				className="mb-4 flex items-center justify-between pb-3"
				style={{ borderBottom: `1px solid ${theme.border}` }}
			>
				<h3
					className="text-xs tracking-widest uppercase"
					style={{
						fontFamily: fonts.body,
						color: theme.textMuted,
					}}
				>
					Tracks
				</h3>
			</div>
			{!tracks || tracks.length === 0 ? (
				<p
					className="py-4 text-sm"
					style={{
						fontFamily: fonts.body,
						color: theme.textMuted,
					}}
				>
					{playlistId
						? "No track data available for this playlist yet."
						: "Select a playlist to see tracks."}
				</p>
			) : (
				tracks.slice(0, 12).map((track, index) => (
					<div
						key={track.songId}
						className="group flex items-center gap-4 py-3 transition-colors duration-150 ease-out"
						style={{
							borderBottom: `1px solid ${theme.border}`,
							animation: `playlist-track-enter 200ms cubic-bezier(0.23, 1, 0.32, 1) ${index * 20}ms both`,
						}}
						onMouseEnter={(e) =>
							(e.currentTarget.style.background = theme.surface)
						}
						onMouseLeave={(e) =>
							(e.currentTarget.style.background = "transparent")
						}
					>
						<span
							className="w-6 text-right text-xs tabular-nums"
							style={{
								fontFamily: fonts.body,
								color: theme.textMuted,
							}}
						>
							{track.position + 1}
						</span>
						<div className="min-w-0 flex-1">
							<p
								className="truncate text-sm"
								style={{
									fontFamily: fonts.body,
									color: theme.text,
								}}
							>
								{track.name}
							</p>
							<p
								className="truncate text-xs"
								style={{
									fontFamily: fonts.body,
									color: theme.textMuted,
								}}
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
