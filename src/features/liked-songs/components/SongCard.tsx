import {
	ArrowRightIcon,
	CheckIcon,
	LockSimpleIcon,
} from "@phosphor-icons/react";
import { memo, useCallback, useMemo } from "react";

import { AlbumPlaceholder } from "@/components/ui/AlbumPlaceholder";
import { fonts } from "@/lib/theme/fonts";
import type { LikedSong } from "../types";
import { formatRelativeTime, isNewSong } from "../types";

interface SongCardProps {
	song: LikedSong;
	albumArtUrl?: string;
	isSelected: boolean;
	isFocused?: boolean;
	itemRef: (el: HTMLElement | null) => void;
	tabIndex: number;
	dataFocused: boolean;
	navEngaged: boolean;
	dataTabFocused?: boolean;
	onPointerDown?: React.PointerEventHandler<HTMLElement>;
	onFocus?: React.FocusEventHandler<HTMLElement>;
	onBlur?: React.FocusEventHandler<HTMLElement>;
	onClickSong: (songId: string, element: HTMLElement) => void;
	isAnimatingTo?: boolean;
	selectionMode?: boolean;
	isChecked?: boolean;
	onToggleSelect?: (songId: string) => void;
	scrollMarginTop?: string;
	isEnabled?: boolean;
	isWalkthroughHighlight?: boolean;
}

interface SongCardContentProps {
	song: LikedSong;
	albumArtUrl?: string;
	isSelected: boolean;
	isAnimatingTo: boolean;
	isSelectable: boolean;
	isChecked: boolean;
	isWalkthroughHighlight: boolean;
	showWalkthroughUi: boolean;
}

export const SongCard = memo(function SongCard({
	song,
	albumArtUrl,
	isSelected,
	isFocused = false,
	itemRef,
	tabIndex,
	dataFocused,
	navEngaged,
	dataTabFocused = false,
	onPointerDown,
	onFocus,
	onBlur,
	onClickSong,
	isAnimatingTo = false,
	selectionMode = false,
	isChecked = false,
	onToggleSelect,
	scrollMarginTop,
	isEnabled = true,
	isWalkthroughHighlight = false,
}: SongCardProps) {
	const songId = song.track.id;
	const isLocked = song.displayState === "locked";
	const isSelectable = selectionMode && isLocked;
	const isSelectionChecked = isSelectable && isChecked;
	const showWalkthroughUi = isWalkthroughHighlight && !isFocused && !isSelected;

	const handleSongClick = useCallback(
		(event: React.MouseEvent<HTMLElement>) => {
			onClickSong(songId, event.currentTarget);
		},
		[onClickSong, songId],
	);

	const handleSelectClick = useCallback(
		(event: React.MouseEvent<HTMLElement>) => {
			event.stopPropagation();
			onToggleSelect?.(songId);
		},
		[onToggleSelect, songId],
	);

	const buttonStyle = useMemo<React.CSSProperties>(
		() =>
			({
				"--hover-bg": isEnabled
					? "color-mix(in srgb, var(--t-text) 6%, transparent)"
					: "transparent",
				position: "relative",
				background: isSelectionChecked
					? "var(--t-surface-dim)"
					: isSelected
						? "var(--t-surface)"
						: undefined,
				borderLeft:
					isFocused || isSelected || showWalkthroughUi
						? "2px solid var(--t-primary)"
						: "2px solid transparent",
				marginLeft: "-2px",
				scrollMarginTop,
				opacity: !isEnabled ? 0.5 : isSelectionChecked ? 1 : isLocked ? 0.6 : 1,
				pointerEvents: !isEnabled ? "none" : undefined,
				animation: isWalkthroughHighlight
					? "walkthrough-pulse 2s ease-in-out infinite"
					: undefined,
			}) as React.CSSProperties,
		[
			isEnabled,
			isSelectionChecked,
			isSelected,
			isFocused,
			showWalkthroughUi,
			scrollMarginTop,
			isLocked,
			isWalkthroughHighlight,
		],
	);

	return (
		<button
			type="button"
			onClick={isSelectable ? handleSelectClick : handleSongClick}
			ref={itemRef}
			tabIndex={tabIndex}
			data-focused={dataFocused}
			data-nav-engaged={navEngaged}
			data-tab-focused={dataTabFocused}
			onPointerDown={onPointerDown}
			onFocus={onFocus}
			onBlur={onBlur}
			className={`song-card -mx-3 flex w-full cursor-pointer items-center gap-4 border-0 bg-transparent px-5 py-4 text-left transition-transform duration-100 active:scale-[0.98]${isWalkthroughHighlight ? " walkthrough-highlight" : ""}`}
			style={buttonStyle}
		>
			<SongCardContent
				song={song}
				albumArtUrl={albumArtUrl}
				isSelected={isSelected}
				isAnimatingTo={isAnimatingTo}
				isSelectable={isSelectable}
				isChecked={isChecked}
				isWalkthroughHighlight={isWalkthroughHighlight}
				showWalkthroughUi={showWalkthroughUi}
			/>
		</button>
	);
});

const SongCardContent = memo(function SongCardContent({
	song,
	albumArtUrl,
	isSelected,
	isAnimatingTo,
	isSelectable,
	isChecked,
	isWalkthroughHighlight,
	showWalkthroughUi,
}: SongCardContentProps) {
	const isNew = isNewSong(song.liked_at);
	const isLocked = song.displayState === "locked";
	const isSelectionChecked = isSelectable && isChecked;

	return (
		<>
			{isWalkthroughHighlight && (
				<style>{`
					@keyframes walkthrough-pulse {
						0%, 100% { background: transparent; }
						50% { background: color-mix(in srgb, var(--t-primary) 8%, transparent); }
					}
					@keyframes walkthrough-arrow-nudge {
						0%, 100% { transform: translateX(0); }
						50% { transform: translateX(3px); }
					}
					@keyframes walkthrough-hint-in {
						from { opacity: 0; transform: translateY(4px); }
						to { opacity: 1; transform: translateY(0); }
					}
					@media (prefers-reduced-motion: reduce) {
						.walkthrough-highlight { animation: none !important; }
						.walkthrough-arrow-nudge { animation: none !important; }
						.walkthrough-hint { animation: none !important; }
					}
				`}</style>
			)}
			<div
				className="relative size-12 shrink-0 overflow-hidden"
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
					<div className="absolute inset-0 flex items-center justify-center bg-black/35">
						<LockSimpleIcon size={16} color="white" weight="regular" />
					</div>
				)}
				{!isLocked && isNew && (
					<div className="theme-primary-bg absolute top-1 right-1 size-2 rounded-full" />
				)}
			</div>

			<div className="min-w-0 flex-1">
				<h3
					className={`${isSelectionChecked || !isLocked ? "theme-text" : "theme-text-muted"} truncate text-base`}
					style={{
						fontFamily: fonts.display,
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
						color: isSelectionChecked
							? "color-mix(in srgb, var(--t-text) 72%, var(--t-text-muted))"
							: "var(--t-text-muted)",
						viewTransitionName: isAnimatingTo ? "song-artist" : "none",
					}}
				>
					{song.track.artist}
				</p>
			</div>

			{showWalkthroughUi && (
				<span
					className="theme-primary walkthrough-hint flex shrink-0 items-center gap-1.5 text-sm font-medium tracking-wide"
					style={{
						fontFamily: fonts.body,
						animation: "walkthrough-hint-in 0.4s ease-out 0.6s both",
					}}
				>
					See what's inside
					<span
						className="walkthrough-arrow-nudge inline-block"
						style={{
							animation: "walkthrough-arrow-nudge 2s ease-in-out infinite",
						}}
					>
						<ArrowRightIcon size={14} />
					</span>
				</span>
			)}

			{!showWalkthroughUi &&
				(isSelectable ? (
					<span
						className={`${isChecked ? "theme-primary-bg" : "bg-transparent"} ${isChecked ? "border-(--t-primary)" : "theme-border-color"} flex size-5 shrink-0 items-center justify-center border`}
					>
						{isChecked && (
							<CheckIcon
								size={12}
								color="var(--t-text-on-primary)"
								weight="bold"
							/>
						)}
					</span>
				) : (
					<span
						className="theme-text-muted hidden shrink-0 text-xs tabular-nums md:block"
						style={{ fontFamily: fonts.body }}
					>
						{formatRelativeTime(song.liked_at)}
					</span>
				))}
		</>
	);
});
