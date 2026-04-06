/**
 * Component: SongCard
 *
 * Clickable song row in the list. When clicked, triggers FLIP expansion
 * to the SongDetailView overlay.
 */
import { Check, Lock } from "lucide-react";

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
	/** When true, locked songs show a checkbox for multi-select */
	selectionMode?: boolean;
	/** Whether this song is checked in selection mode */
	isChecked?: boolean;
	/** Toggle selection in multi-select mode */
	onToggleSelect?: (songId: string) => void;
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
	selectionMode,
	isChecked,
	onToggleSelect,
}: SongCardProps) {
	const theme = useTheme();
	const isNew = isNewSong(song.liked_at);
	const isLocked = song.displayState === "locked";
	const isSelectable = selectionMode && isLocked;

	return (
		<button
			type="button"
			onClick={
				isSelectable
					? (e) => {
							e.stopPropagation();
							onToggleSelect?.(song.track.id);
						}
					: onClick
			}
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
					opacity: isLocked ? 0.6 : 1,
				} as React.CSSProperties
			}
		>
			{/* Album art */}
			<div
				className="relative h-12 w-12 shrink-0 overflow-hidden"
				style={{
					viewTransitionName: isAnimatingTo ? "song-album" : "none",
				}}
			>
				{albumArtUrl ? (
					<img
						src={albumArtUrl}
						alt={`${song.track.album || song.track.name} album art`}
						className="h-full w-full object-cover"
						style={isLocked ? { filter: "grayscale(0.5)" } : undefined}
					/>
				) : (
					<AlbumPlaceholder />
				)}
				{isLocked && (
					<div
						className="absolute inset-0 flex items-center justify-center"
						style={{ background: "rgba(0,0,0,0.35)" }}
					>
						<Lock size={16} color="white" strokeWidth={2} />
					</div>
				)}
				{!isLocked && isNew && (
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
						color: isLocked ? theme.textMuted : theme.text,
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

			{/* Selection checkbox / Lock affordance / Time added */}
			{isSelectable ? (
				<span
					className="flex h-5 w-5 shrink-0 items-center justify-center rounded border"
					style={{
						borderColor: isChecked ? theme.primary : theme.border,
						background: isChecked ? theme.primary : "transparent",
					}}
				>
					{isChecked && <Check size={12} color={theme.bg} strokeWidth={3} />}
				</span>
			) : isLocked ? (
				<span
					className="flex shrink-0 items-center gap-1 text-xs"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					<Lock size={11} strokeWidth={2} />
					<span className="hidden lg:inline">Unlock</span>
				</span>
			) : (
				<span
					className="hidden shrink-0 text-xs lg:block"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					{formatRelativeTime(song.liked_at)}
				</span>
			)}
		</button>
	);
}
