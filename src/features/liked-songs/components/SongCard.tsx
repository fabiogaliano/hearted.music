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

// Rows sit on the library panel, so every engaged fill here is measured against
// THAT, not against --t-surface. --t-plane-lit resolves to the panel's own lit
// step (see styles.css), which is the same fill .surface-raised-hover paints —
// so a row under the pointer and a row the keyboard cursor is on are one state.
//
// Open is the opposite direction: it drops to the chip tier, the fill every
// control in the studio already rests at. The row whose panel is showing reads
// as the slot its contents came out of rather than as a second hovered row —
// which is what it was, since open and hover used to be the same value.
// Spelled out rather than tokenised because it is not a plane-relative value:
// it lands one step below THIS plane, and would be wrong (above the fill) on a
// row that sits directly on the page.
const ROW_OPEN =
	"oklch(from var(--t-surface) calc(l - 0.025) calc(c + 0.003) calc(h + 3))";
// A primary wash over the lit fill: "I picked this" has to survive next to a
// row that's merely under the pointer.
const ROW_CHECKED =
	"color-mix(in oklch, var(--t-primary) 12%, var(--t-plane-lit))";

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
	suppressPointerFocus?: boolean;
	onClickSong: (songId: string, element: HTMLElement) => void;
	isAnimatingTo?: boolean;
	selectionMode?: boolean;
	isChecked?: boolean;
	onToggleSelect?: (songId: string) => void;
	scrollMarginTop?: string;
	isEnabled?: boolean;
	isWalkthroughHighlight?: boolean;
	/** The list is in the onboarding walkthrough — hides the per-song "new" badge. */
	isWalkthrough?: boolean;
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
	isWalkthrough: boolean;
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
	suppressPointerFocus = false,
	onClickSong,
	isAnimatingTo = false,
	selectionMode = false,
	isChecked = false,
	onToggleSelect,
	scrollMarginTop,
	isEnabled = true,
	isWalkthroughHighlight = false,
	isWalkthrough = false,
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

	const handlePointerDown = useCallback(
		(event: React.PointerEvent<HTMLElement>) => {
			if (suppressPointerFocus) {
				event.preventDefault();
			}
			onPointerDown?.(event);
		},
		[onPointerDown, suppressPointerFocus],
	);

	const buttonStyle = useMemo<React.CSSProperties>(() => {
		let opacity = 1;
		if (!isEnabled) {
			opacity = 0.5;
		} else if (isSelectionChecked) {
			opacity = 1;
		} else if (isLocked) {
			opacity = 0.6;
		}

		// Keyboard focus used to be a 2px primary rail on the left edge — the one
		// mark on the row that wasn't a fill, and one that had to be mirrored by a
		// -2px margin so unfocused rows still lined up. It takes the lit fill
		// instead: data-focused suppresses the browser outline, so the row still
		// says where the cursor is with nothing hanging off it.
		//
		// Focus outranks open when a row is both, which only happens under arrow
		// navigation (data-focused is keyboard-only, so a click opens a row without
		// focusing it). In keyboard mode the fill is the ONLY cursor cue, whereas
		// the open row is also announced by the panel standing open beside it — so
		// losing the cursor would cost more than losing the marker.
		let background: string | undefined;
		if (isSelectionChecked) {
			background = ROW_CHECKED;
		} else if (isFocused) {
			background = "var(--t-plane-lit)";
		} else if (isSelected) {
			background = ROW_OPEN;
		}

		return {
			position: "relative",
			background,
			scrollMarginTop,
			opacity,
			pointerEvents: !isEnabled ? "none" : undefined,
			animation: isWalkthroughHighlight
				? "walkthrough-pulse 2s ease-in-out infinite"
				: undefined,
		} as React.CSSProperties;
	}, [
		isEnabled,
		isSelectionChecked,
		isSelected,
		isFocused,
		scrollMarginTop,
		isLocked,
		isWalkthroughHighlight,
	]);

	return (
		<button
			type="button"
			onClick={isSelectable ? handleSelectClick : handleSongClick}
			ref={itemRef}
			tabIndex={tabIndex}
			data-focused={dataFocused}
			data-nav-engaged={navEngaged}
			data-tab-focused={dataTabFocused}
			onPointerDown={handlePointerDown}
			onFocus={onFocus}
			onBlur={onBlur}
			// The hover was `color-mix(in srgb, var(--t-text) 6%, transparent)` — all
			// but exactly the value the vision stories label as the CURRENT treatment
			// and replace. It's the shared row temperature now, so a row here reads
			// the same as one in the dashboard feed or a match column. Gated on
			// isEnabled because a disabled row must not respond to the pointer; that
			// used to be done by zeroing an inline --hover-bg.
			// The -mx-3 bleed is gone with the plane: a row no longer has to reach
			// past a content column to prove it's interactive, it just fills the
			// panel's padded interior. px-3 + the panel's px-2 restores the same
			// 20px content inset the studio's tracklist rows sit at.
			className={`song-card squircle flex w-full cursor-pointer items-center gap-4 rounded-[10px] border-0 bg-transparent px-3 py-3 text-left transition-[transform,background-color] duration-150 ease-out active:scale-[0.98]${isEnabled ? " surface-raised-hover" : ""}${isWalkthroughHighlight ? " walkthrough-highlight" : ""}`}
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
				isWalkthrough={isWalkthrough}
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
	isWalkthrough,
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
				{/* image-outline on the art itself, not the wrapper: the ring is an
				    inset shadow, which the wrapper would paint BEHIND its own
				    content. This was the one cover in the app without it, which
				    only started to show once the rows moved onto a light plane —
				    art with a pale edge used to end on the page and now bleeds
				    into the panel. */}
				{albumArtUrl ? (
					<img
						src={albumArtUrl}
						alt={`${song.track.album || song.track.name} album art`}
						className="image-outline h-full w-full object-cover"
						style={isLocked ? { filter: "grayscale(0.5)" } : undefined}
					/>
				) : (
					<AlbumPlaceholder className="image-outline" />
				)}
				{isLocked && (
					<div className="absolute inset-0 flex items-center justify-center bg-black/35">
						<LockSimpleIcon size={16} color="white" weight="regular" />
					</div>
				)}
				{!isWalkthrough && !isLocked && isNew && (
					<div className="theme-primary-bg absolute top-1 right-1 size-2 rounded-full" />
				)}
			</div>

			<div className="min-w-0 flex-1">
				<h3
					className={`${isSelectionChecked || !isLocked ? "theme-text" : "theme-text-muted"} truncate text-[17px]`}
					style={{
						fontFamily: fonts.display,
						fontWeight: isSelected ? 400 : 300,
						viewTransitionName: isAnimatingTo ? "song-title" : "none",
					}}
				>
					{song.track.name}
				</h3>
				<p
					className="mt-0.5 truncate text-[13px]"
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
						className="theme-text-muted hidden shrink-0 text-xs tabular-nums @[500px]:block"
						style={{ fontFamily: fonts.body }}
					>
						{formatRelativeTime(song.liked_at)}
					</span>
				))}
		</>
	);
});
