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
	dataTabFocused?: boolean;
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
	scrollMarginTop?: string;
	/** When false, card is visually dimmed and non-interactive */
	isEnabled?: boolean;
	/** When true, card gets a left border + pulse glow and shows the "See what's inside →" hint */
	isWalkthroughHighlight?: boolean;
	/** Hide the "Unlock" badge on locked rows (used during onboarding where unlocking isn't available) */
	hideLockedBadge?: boolean;
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
	dataTabFocused = false,
	onPointerDown,
	onFocus,
	onBlur,
	onClick,
	isAnimatingTo,
	selectionMode,
	isChecked,
	onToggleSelect,
	scrollMarginTop,
	isEnabled = true,
	isWalkthroughHighlight = false,
	hideLockedBadge = false,
}: SongCardProps) {
	const theme = useTheme();
	const isNew = isNewSong(song.liked_at);
	const isLocked = song.displayState === "locked";
	const isSelectable = selectionMode && isLocked;
	const isSelectionChecked = isSelectable && isChecked;

	const showWalkthroughUi = isWalkthroughHighlight && !isFocused && !isSelected;

	return (
		<>
			{isWalkthroughHighlight && (
				<style>{`
					@keyframes walkthrough-pulse {
						0%, 100% { background: transparent; }
						50% { background: color-mix(in srgb, ${theme.primary} 8%, transparent); }
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
				data-tab-focused={dataTabFocused}
				onPointerDown={onPointerDown}
				onFocus={onFocus}
				onBlur={onBlur}
				className={`song-card -mx-3 flex w-full cursor-pointer items-center gap-4 border-0 bg-transparent px-3 py-4 text-left${isWalkthroughHighlight ? " walkthrough-highlight" : ""}`}
				style={
					{
						"--hover-bg": isEnabled
							? `color-mix(in srgb, ${theme.text} 6%, transparent)`
							: "transparent",
						position: "relative",
						background: isSelectionChecked
							? theme.surfaceDim
							: isSelected
								? theme.surface
								: undefined,
						borderLeft:
							isFocused || isSelected
								? `3px solid ${theme.primary}`
								: showWalkthroughUi
									? `3px solid ${theme.primary}`
									: "3px solid transparent",
						marginLeft: "-3px",
						boxShadow: dataTabFocused
							? `inset 0 0 0 1px ${theme.primary}`
							: undefined,
						scrollMarginTop,
						opacity: !isEnabled
							? 0.5
							: isSelectionChecked
								? 1
								: isLocked
									? 0.6
									: 1,
						pointerEvents: !isEnabled ? "none" : undefined,
						animation: isWalkthroughHighlight
							? "walkthrough-pulse 2s ease-in-out infinite"
							: undefined,
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
							color: isSelectionChecked
								? theme.text
								: isLocked
									? theme.textMuted
									: theme.text,
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
								? `color-mix(in srgb, ${theme.text} 72%, ${theme.textMuted})`
								: theme.textMuted,
							viewTransitionName: isAnimatingTo ? "song-artist" : "none",
						}}
					>
						{song.track.artist}
					</p>
				</div>

				{showWalkthroughUi && (
					<span
						className="walkthrough-hint shrink-0 flex items-center gap-1.5"
						style={{
							fontFamily: fonts.body,
							fontSize: 12,
							color: theme.primary,
							letterSpacing: "0.01em",
							animation: "walkthrough-hint-in 0.4s ease-out 0.6s both",
						}}
					>
						See what's inside
						<span
							className="walkthrough-arrow-nudge inline-block"
							style={{
								animation: "walkthrough-arrow-nudge 2s ease-in-out infinite",
								willChange: "transform",
							}}
						>
							→
						</span>
					</span>
				)}

				{!showWalkthroughUi &&
					(isSelectable ? (
						<span
							className="flex h-5 w-5 shrink-0 items-center justify-center rounded border"
							style={{
								borderColor: isChecked ? theme.primary : theme.border,
								background: isChecked ? theme.primary : "transparent",
							}}
						>
							{isChecked && (
								<Check size={12} color={theme.bg} strokeWidth={3} />
							)}
						</span>
					) : isLocked ? (
						hideLockedBadge ? null : (
							<span
								className="flex shrink-0 items-center gap-1 text-xs"
								style={{ fontFamily: fonts.body, color: theme.textMuted }}
							>
								<Lock size={11} strokeWidth={2} />
								<span className="hidden lg:inline">Unlock</span>
							</span>
						)
					) : (
						<span
							className="hidden shrink-0 text-xs lg:block"
							style={{ fontFamily: fonts.body, color: theme.textMuted }}
						>
							{formatRelativeTime(song.liked_at)}
						</span>
					))}
			</button>
		</>
	);
}
