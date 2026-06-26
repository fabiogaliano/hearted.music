import {
	ArrowLeftIcon,
	ArrowRightIcon,
	PlayIcon,
	XIcon,
} from "@phosphor-icons/react";
import {
	AnimatePresence,
	motion,
	useIsPresent,
	useReducedMotion,
} from "framer-motion";
import { memo, type ReactNode, useEffect, useRef, useState } from "react";
import { AlbumPlaceholder } from "@/components/ui/AlbumPlaceholder";
import { Button } from "@/components/ui/Button";
import { fonts } from "@/lib/theme/fonts";
import type {
	SongForMatching,
	SongSuggestionRow,
	SongSuggestionsSectionProps,
} from "../types";
import { ClientNumberFlow as NumberFlow } from "./ClientNumberFlow";
import {
	preloadSpotifyEmbedAPI,
	SpotifyEmbedIframe,
} from "./SpotifyEmbedIframe";

// Mirrors MatchesSection's MIN_HEIGHT so both columns in the playlist-mode
// grid stay visually consistent regardless of suggestion list length.
const MIN_HEIGHT = "min(clamp(300px, 30vw, 560px), calc(50dvh - 40px))";

export const SongSuggestionsSection = memo(function SongSuggestionsSection({
	itemKey,
	suggestions,
	addedTo,
	navigationDisabled,
	isLastItem,
	suppressTransition,
	onAdd,
	onDismiss,
	onNext,
	onPrevious,
}: SongSuggestionsSectionProps) {
	const prefersReducedMotion = useReducedMotion();

	return (
		<div
			className="flex flex-col"
			style={{
				minHeight: MIN_HEIGHT,
			}}
		>
			{/* Below lg the suggestions stack directly under the playlist cover with
			only the grid gap between them; this border restores the visual break the
			two-column split gives on wider viewports. Hidden at lg, where columns
			sit side by side. */}
			<div className="theme-border-color mb-8 border-t lg:hidden" />

			{/* initial={false}: slide is a review-item transition, not a mount
			entrance. StaggeredContent owns the entrance so the panel doesn't slide
			in beside a static header on first render. */}
			<AnimatePresence mode="wait" initial={false}>
				<AnimatedSuggestionsPanel
					key={itemKey}
					prefersReducedMotion={prefersReducedMotion ?? false}
					instant={suppressTransition ?? false}
				>
					<p
						className="theme-text-muted text-xs tracking-widest uppercase"
						style={{ fontFamily: fonts.body }}
					>
						Song Suggestions
					</p>

					{/* min-h-0 lets the flex child shrink below its intrinsic height so
					overflow-y-auto triggers when the list exceeds available space.
					Controls below stay pinned outside this scrollable region. */}
					<div className="mt-6 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto">
						{suggestions.map((row) => (
							<SongSuggestionRowItem
								key={row.song.id}
								row={row}
								added={addedTo.includes(row.song.id)}
								navigationDisabled={navigationDisabled ?? false}
								onAdd={onAdd}
							/>
						))}
					</div>
				</AnimatedSuggestionsPanel>
			</AnimatePresence>

			{/* Lives outside the keyed AnimatePresence subtree so it always renders
			against the latest committed review item. Stale DOM from the exiting
			panel cannot intercept rapid Next clicks. */}
			<SuggestionsControls
				disabled={navigationDisabled ?? false}
				isLastItem={isLastItem ?? false}
				onDismiss={onDismiss}
				onPrevious={onPrevious}
				onNext={onNext}
			/>
		</div>
	);
});

interface SongSuggestionRowItemProps {
	row: SongSuggestionRow;
	added: boolean;
	navigationDisabled: boolean;
	onAdd: (suggestionId: string) => void;
}

// One song suggestion row: score, album art with play affordance, name/artist,
// and Add/Added action. A named component (not an inline map body) so
// SongAlbumWithPlay's local state is owned once per row under the rules of
// hooks. Keyboard tab order per row: play button, then Add button.
function SongSuggestionRowItem({
	row,
	added,
	navigationDisabled,
	onAdd,
}: SongSuggestionRowItemProps) {
	const { song, fitScore } = row;

	return (
		<div className="theme-border-color border-b pb-6">
			<div className="flex items-center gap-6 py-1 pr-1">
				<div className="shrink-0">
					<NumberFlow
						value={Math.round(fitScore * 100)}
						suffix="%"
						className="theme-text font-extralight tabular-nums leading-none"
						style={{ fontFamily: fonts.display, fontSize: "1.5rem" }}
					/>
				</div>

				<div className="flex min-w-0 flex-1 items-center gap-4">
					<SongAlbumWithPlay song={song} />

					<div className="min-w-0 flex-1">
						<p
							className="theme-text truncate font-light leading-[1.15]"
							style={{ fontFamily: fonts.display, fontSize: "1.5rem" }}
							title={song.name}
						>
							{song.name}
						</p>
						<p
							className="theme-text-muted mt-1.5 text-xs leading-snug"
							style={{ fontFamily: fonts.body }}
						>
							{song.artist}
						</p>
					</div>
				</div>

				<div className="shrink-0">
					{added ? (
						<span
							className="theme-text-muted text-xs tracking-widest uppercase opacity-60"
							style={{ fontFamily: fonts.body }}
						>
							Added
						</span>
					) : (
						<Button
							variant="secondary"
							size="sm"
							disabled={navigationDisabled}
							onClick={() => onAdd(song.id)}
						>
							Add
						</Button>
					)}
				</div>
			</div>
		</div>
	);
}

interface SongAlbumWithPlayProps {
	song: SongForMatching;
}

// Album art thumbnail with an optional Spotify play button overlay. The 48×48
// container stays fixed before and after activation so row layout is stable.
// Keyboard tab order: this play button precedes the Add button in DOM order,
// satisfying the per-row keyboard navigation requirement (story constraint).
function SongAlbumWithPlay({ song }: SongAlbumWithPlayProps) {
	const [activated, setActivated] = useState(false);
	const [premounted, setPremounted] = useState(false);
	const premountTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const canPreview = Boolean(song.spotifyId);

	useEffect(() => {
		return () => {
			if (premountTimerRef.current) clearTimeout(premountTimerRef.current);
		};
	}, []);

	const cancelPremount = () => {
		if (premountTimerRef.current) {
			clearTimeout(premountTimerRef.current);
			premountTimerRef.current = null;
		}
	};

	const warmPreview = (delayMs: 0 | 50) => {
		preloadSpotifyEmbedAPI();
		if (premounted) return;
		cancelPremount();
		if (delayMs === 0) {
			setPremounted(true);
			return;
		}
		// Brief delay filters incidental pointer movement from deliberate hover,
		// matching the SongSection warmup pattern.
		premountTimerRef.current = setTimeout(() => {
			setPremounted(true);
			premountTimerRef.current = null;
		}, delayMs);
	};

	const showIframe = canPreview && song.spotifyId && (premounted || activated);

	return (
		<div
			className="relative shrink-0 overflow-hidden"
			style={{ width: 48, height: 48 }}
		>
			{!activated &&
				(song.albumArtUrl ? (
					<img
						src={song.albumArtUrl}
						alt={song.album ?? ""}
						className="absolute inset-0 h-full w-full object-cover"
					/>
				) : (
					<div className="absolute inset-0">
						<AlbumPlaceholder />
					</div>
				))}

			{canPreview && !activated && (
				<button
					type="button"
					onClick={() => {
						warmPreview(0);
						setActivated(true);
					}}
					onPointerEnter={() => warmPreview(50)}
					onPointerDown={() => warmPreview(0)}
					onPointerLeave={cancelPremount}
					onFocus={() => warmPreview(50)}
					onBlur={cancelPremount}
					className="group absolute inset-0 z-10 flex cursor-pointer items-center justify-center bg-black/10 transition-colors duration-200 hover:bg-black/35 focus-visible:bg-black/35 focus-visible:outline-none motion-safe:active:scale-[0.96]"
					aria-label={`Play preview for ${song.name}`}
				>
					<span className="theme-primary flex size-8 items-center justify-center rounded-full bg-white/70 shadow-sm [transition:transform_200ms_cubic-bezier(0.165,0.84,0.44,1)] group-hover:scale-110 group-hover:bg-white group-focus-visible:scale-110 group-focus-visible:bg-white group-focus-visible:ring-2 group-focus-visible:ring-[var(--ring)] group-focus-visible:ring-inset">
						<PlayIcon size={14} weight="fill" style={{ marginLeft: 1 }} />
					</span>
				</button>
			)}

			{showIframe && song.spotifyId && (
				<motion.div
					className="absolute inset-0"
					initial={{ opacity: 0 }}
					animate={{
						opacity: activated ? 1 : 0,
						transition: { duration: 0.25, ease: [0.165, 0.84, 0.44, 1] },
					}}
					style={{ pointerEvents: activated ? "auto" : "none" }}
				>
					<SpotifyEmbedIframe
						spotifyId={song.spotifyId}
						playWhenReady={activated}
					/>
					{activated && (
						<button
							type="button"
							onClick={() => setActivated(false)}
							aria-label="Close preview"
							className="absolute top-1 left-1 z-10 cursor-pointer text-white opacity-90 drop-shadow-md transition-opacity duration-200 hover:opacity-100 motion-safe:active:scale-[0.96]"
						>
							<XIcon size={14} weight="bold" />
						</button>
					)}
				</motion.div>
			)}

			{/* Inset ring for subtle definition on light-colored covers, matching the
			PlaylistReviewItemSection and SongSection album art treatment. */}
			<div
				className="pointer-events-none absolute inset-0 z-20"
				style={{ boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.16)" }}
			/>
		</div>
	);
}

interface AnimatedSuggestionsPanelProps {
	prefersReducedMotion: boolean;
	/** Skip the slide and swap immediately — see SongSuggestionsSectionProps.suppressTransition. */
	instant?: boolean;
	children: ReactNode;
}

function AnimatedSuggestionsPanel({
	prefersReducedMotion,
	instant,
	children,
}: AnimatedSuggestionsPanelProps) {
	// While exiting, this subtree is still mounted but stale; block input so
	// users cannot click "Add" buttons that belong to the previous review item.
	const isPresent = useIsPresent();
	const skip = instant || prefersReducedMotion;
	return (
		<motion.div
			className="flex flex-1 flex-col"
			initial={skip ? false : { opacity: 0, x: 20 }}
			animate={{
				opacity: 1,
				x: 0,
				transition: skip
					? { duration: 0 }
					: { duration: 0.25, ease: [0.165, 0.84, 0.44, 1] },
			}}
			exit={
				skip
					? {}
					: {
							opacity: 0,
							x: -20,
							transition: {
								duration: 0.18,
								ease: [0.645, 0.045, 0.355, 1],
							},
						}
			}
			style={{ pointerEvents: isPresent ? "auto" : "none" }}
		>
			{children}
		</motion.div>
	);
}

interface SuggestionsControlsProps {
	disabled: boolean;
	isLastItem: boolean;
	onDismiss: () => void | Promise<void>;
	onPrevious?: () => void;
	onNext: () => void;
}

function SuggestionsControls({
	disabled,
	isLastItem,
	onDismiss,
	onPrevious,
	onNext,
}: SuggestionsControlsProps) {
	return (
		<div className="mt-8 flex items-center justify-between">
			<Button
				variant="ghost"
				size="sm"
				disabled={disabled}
				onClick={onDismiss}
				style={{ fontFamily: fonts.body }}
			>
				<span className="inline-flex min-h-11 items-center gap-1.5">
					<XIcon size={14} weight="regular" />
					Dismiss
				</span>
			</Button>

			<div className="flex items-center gap-6">
				{onPrevious && (
					<Button
						variant="ghost"
						size="sm"
						disabled={disabled}
						onClick={onPrevious}
						style={{ fontFamily: fonts.body }}
					>
						<span className="inline-flex min-h-11 items-center gap-1.5">
							<ArrowLeftIcon size={14} weight="regular" />
							Previous
						</span>
					</Button>
				)}
				<Button
					variant="link"
					disabled={disabled}
					onClick={onNext}
					style={{ fontFamily: fonts.body }}
				>
					<span className="text-base font-medium tracking-wide">
						{isLastItem ? "Finish matching" : "Skip Playlist"}
					</span>
					<ArrowRightIcon
						size={16}
						weight="regular"
						className="theme-text-muted transition-transform duration-200 ease-out motion-safe:group-hover:translate-x-1"
					/>
				</Button>
			</div>
		</div>
	);
}
