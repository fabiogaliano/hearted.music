/**
 * Component: SongCard
 *
 * Clickable song row in the list. When clicked, triggers FLIP expansion
 * to the SongDetailView overlay.
 */
import { AlbumPlaceholder } from "@/components/ui/AlbumPlaceholder";
import { fonts } from "@/lib/theme/fonts";
import { useTheme } from "@/lib/theme/ThemeHueProvider";
import type { LikedSong } from "../types";
import { formatRelativeTime, isNewSong } from "../types";

interface SongCardProps {
	song: LikedSong;
	albumArtUrl?: string;
	isSelected: boolean;
	/** Keyboard focus state (separate from selected/expanded) */
	isFocused?: boolean;
	itemRef: (el: HTMLElement | null) => void;
	tabIndex: number;
	dataFocused: boolean;
	navEngaged: boolean;
	onPointerDown?: React.PointerEventHandler<HTMLElement>;
	onFocus?: React.FocusEventHandler<HTMLElement>;
	onBlur?: React.FocusEventHandler<HTMLElement>;
	onClick: (e: React.MouseEvent<HTMLElement>) => void;
	/** True when this card is the target of a close animation (view transitions) */
	isAnimatingTo?: boolean;
}

export function SongCard({
	song,
	albumArtUrl,
	isSelected,
	isFocused,
	itemRef,
	tabIndex,
	dataFocused,
	navEngaged,
	onPointerDown,
	onFocus,
	onBlur,
	onClick,
	isAnimatingTo,
}: SongCardProps) {
	const theme = useTheme();
	const isNew = isNewSong(song.liked_at);

	return (
		<button
			type="button"
			onClick={onClick}
			ref={itemRef}
			tabIndex={tabIndex}
			data-focused={dataFocused}
			data-nav-engaged={navEngaged}
			onPointerDown={onPointerDown}
			onFocus={onFocus}
			onBlur={onBlur}
			className="song-card -mx-3 flex w-full cursor-pointer items-center gap-4 border-0 bg-transparent px-3 py-4 text-left"
			style={
				{
					"--hover-bg": `color-mix(in srgb, ${theme.text} 6%, transparent)`,
					background: isSelected ? theme.surface : undefined,
					borderLeft:
						isFocused || isSelected
							? `3px solid ${theme.primary}`
							: "3px solid transparent",
					marginLeft: "-3px",
					transition: "background 200ms ease",
				} as React.CSSProperties
			}
		>
			{/* Album art */}
			<div
				className="relative h-12 w-12 shrink-0 overflow-hidden"
				style={{
					// View Transition: only the target card gets the name during close animation
					viewTransitionName: isAnimatingTo ? "song-album" : "none",
				}}
			>
				{albumArtUrl ? (
					<img
						src={albumArtUrl}
						alt={`${song.track.album || song.track.name} album art`}
						className="h-full w-full object-cover"
					/>
				) : (
					<AlbumPlaceholder />
				)}
				{/* New indicator dot */}
				{isNew && (
					<div
						className="absolute top-1 right-1 h-2 w-2 rounded-full"
						style={{ background: theme.primary }}
					/>
				)}
			</div>

			{/* Track info */}
			<div className="min-w-0 flex-1">
				<h3
					className="truncate text-base"
					style={{
						fontFamily: fonts.display,
						color: theme.text,
						fontWeight: isSelected ? 400 : 300,
						// View Transition: only the target card gets the name during close animation
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
						// View Transition: only the target card gets the name during close animation
						viewTransitionName: isAnimatingTo ? "song-artist" : "none",
					}}
				>
					{song.track.artist}
				</p>
			</div>

			{/* Time added - hidden on small/medium screens to save space */}
			<span
				className="hidden shrink-0 text-xs lg:block"
				style={{ fontFamily: fonts.body, color: theme.textMuted }}
			>
				{formatRelativeTime(song.liked_at)}
			</span>
		</button>
	);
}
