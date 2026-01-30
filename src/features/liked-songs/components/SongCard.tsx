/**
 * Component: SongCard
 *
 * Clickable song row in the list. When clicked, triggers expansion
 * to the SongDetailPanel overlay.
 */
import { fonts } from "@/lib/theme/fonts";
import { useTheme } from "@/lib/theme/useTheme";
import { DEFAULT_THEME } from "@/lib/theme/types";
import type { SongCardProps } from "../types";
import { formatRelativeTime, isNewSong } from "../types";

export function SongCard({
	song,
	albumArtUrl,
	isSelected,
	isFocused,
	onClick,
	isAnimatingTo,
}: SongCardProps) {
	const { theme } = useTheme(DEFAULT_THEME);
	const isNew = isNewSong(song.liked_at);

	return (
		<button
			type="button"
			onClick={onClick}
			className="group -mx-3 flex w-full cursor-pointer items-center gap-4 border-none px-3 py-4 text-left transition-all duration-200"
			style={{
				background: isSelected ? theme.surface : "transparent",
				borderLeft: isFocused
					? `3px solid ${theme.primary}`
					: "3px solid transparent",
				marginLeft: "-3px",
			}}
		>
			<div
				className="relative h-12 w-12 flex-shrink-0 overflow-hidden"
				style={{
					background: albumArtUrl
						? "transparent"
						: `linear-gradient(135deg, ${theme.surfaceDim} 0%, ${theme.border} 100%)`,
					viewTransitionName: isAnimatingTo ? "song-album" : "none",
				}}
			>
				{albumArtUrl && (
					<img
						src={albumArtUrl}
						alt={`${song.track.album || song.track.name} album art`}
						className="h-full w-full object-cover"
					/>
				)}
				{isNew && (
					<div
						className="absolute top-1 right-1 h-2 w-2 rounded-full"
						style={{ background: theme.primary }}
					/>
				)}
			</div>

			<div className="min-w-0 flex-1">
				<h3
					className="truncate text-base"
					style={{
						fontFamily: fonts.display,
						color: theme.text,
						fontWeight: isSelected ? 400 : 300,
						viewTransitionName: isAnimatingTo ? "song-title" : "none",
					}}
				>
					{song.track.name}
				</h3>
				<p
					className="mt-0.5 truncate text-sm"
					style={{
						fontFamily: fonts.body,
						color: theme.textMuted,
						viewTransitionName: isAnimatingTo ? "song-artist" : "none",
					}}
				>
					{song.track.artist}
				</p>
			</div>

			<span
				className="hidden flex-shrink-0 text-xs lg:block"
				style={{ fontFamily: fonts.body, color: theme.textMuted }}
			>
				{formatRelativeTime(song.liked_at)}
			</span>

			<div
				className="h-8 w-0.5 rounded-full opacity-0 transition-opacity group-hover:opacity-100"
				style={{ background: theme.text }}
			/>
		</button>
	);
}
