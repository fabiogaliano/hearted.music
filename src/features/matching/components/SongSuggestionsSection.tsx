import { ArrowLeftIcon, ArrowRightIcon, XIcon } from "@phosphor-icons/react";
import {
	AnimatePresence,
	motion,
	useIsPresent,
	useReducedMotion,
} from "framer-motion";
import { memo, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { SpotifyPlaybackCover } from "@/features/playback/SpotifyPlaybackCover";
import { useSingleActivePlayback } from "@/features/playback/useSingleActivePlayback";
import { useInfiniteScroll } from "@/lib/hooks/useInfiniteScroll";
import { fonts } from "@/lib/theme/fonts";
import type { SongSuggestionRow, SongSuggestionsSectionProps } from "../types";
import { ClientNumberFlow as NumberFlow } from "./ClientNumberFlow";
import { ReviewListScroll } from "./ReviewListScroll";

// Mirrors MatchesSection's MIN_HEIGHT so both columns in the playlist-mode
// grid stay visually consistent regardless of suggestion list length.
const MIN_HEIGHT = "min(clamp(300px, 34vw, 620px), calc(56dvh - 40px))";

export const SongSuggestionsSection = memo(function SongSuggestionsSection({
	itemKey,
	suggestions,
	playback,
	addedTo,
	navigationDisabled,
	isLastItem,
	suppressTransition,
	// suggestionTotal drives SuggestionsControls' pluralization below; the rest
	// drive the tail-paging sentinel/retry footer rendered in ReviewListScroll.
	suggestionTotal,
	hasMoreSuggestions,
	isLoadingMoreSuggestions,
	loadMoreSuggestions,
	loadMoreError,
	retryLoadMore,
	onAdd,
	onDismissSuggestion,
	onDismiss,
	onNext,
	onPrevious,
}: SongSuggestionsSectionProps) {
	const prefersReducedMotion = useReducedMotion();

	// A load-more error stops the auto-observer (retry is manual) but keeps
	// hasMoreSuggestions true so the empty-state gate below stays suppressed —
	// pagination isn't "done", it's stalled, and the footer should say so.
	const { sentinelRef } = useInfiniteScroll({
		onLoadMore: loadMoreSuggestions ?? (() => {}),
		hasMore: (hasMoreSuggestions ?? false) && !loadMoreError,
	});

	const liveAnnouncement = loadMoreError
		? "Couldn't load more suggestions."
		: isLoadingMoreSuggestions
			? "Loading more…"
			: "";

	const suggestionsFooter = loadMoreError ? (
		<div
			className="theme-text-muted flex items-center justify-center gap-1.5 py-3 text-center text-xs"
			style={{ fontFamily: fonts.body }}
		>
			<span>Couldn't load more suggestions.</span>
			<button
				type="button"
				onClick={retryLoadMore}
				className="theme-text cursor-pointer underline underline-offset-2 opacity-90 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
			>
				Retry
			</button>
		</div>
	) : hasMoreSuggestions ? (
		<div
			ref={sentinelRef}
			className="theme-text-muted py-3 text-center text-xs"
			style={{ fontFamily: fonts.body }}
		>
			{isLoadingMoreSuggestions ? "Loading more…" : null}
		</div>
	) : null;

	// One active preview at a time. Each row owns its play affordance but not the
	// decision of *which* row plays. Normally that decision is shared with the
	// track-list column via the `playback` coordinator passed from MatchingSession,
	// so playing a track there pauses a suggestion here. The local fallback (keyed by
	// itemKey to reset on navigation) only runs in standalone/Ladle use.
	const localPlayback = useSingleActivePlayback(itemKey);
	const { activePlaybackId, activatePlayback, deactivatePlayback } =
		playback ?? localPlayback;

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

			<div aria-live="polite" aria-atomic="true" className="sr-only">
				{liveAnnouncement}
			</div>

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

					<ReviewListScroll footer={suggestionsFooter}>
						{suggestions.length === 0 && !hasMoreSuggestions ? (
							<p
								className="theme-text-muted text-sm"
								style={{ fontFamily: fonts.body }}
							>
								All suggestions reviewed.
							</p>
						) : (
							suggestions.map((row) => (
								<SongSuggestionRowItem
									key={row.song.id}
									row={row}
									added={addedTo.includes(row.song.id)}
									navigationDisabled={navigationDisabled ?? false}
									onAdd={onAdd}
									onDismiss={onDismissSuggestion}
									isActive={activePlaybackId === row.song.id}
									onActivate={activatePlayback}
									onDeactivate={deactivatePlayback}
								/>
							))
						)}
					</ReviewListScroll>
				</AnimatedSuggestionsPanel>
			</AnimatePresence>

			{/* Lives outside the keyed AnimatePresence subtree so it always renders
			against the latest committed review item. Stale DOM from the exiting
			panel cannot intercept rapid Next clicks. */}
			<SuggestionsControls
				disabled={navigationDisabled ?? false}
				isLastItem={isLastItem ?? false}
				// suggestionTotal (capped, post-dismissal) is the playlist-mode source
				// of truth once tail paging is in play — suggestions.length undercounts
				// once earlier rows are loaded but later ones aren't yet.
				suggestionCount={suggestionTotal ?? suggestions.length}
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
	onDismiss?: (suggestionId: string) => void | Promise<void>;
	/** True when this row's preview is the one playing (see activeSongId). */
	isActive: boolean;
	onActivate: (songId: string) => void;
	onDeactivate: () => void;
}

// One song suggestion row: score, album art with play affordance, name/artist,
// and Add/Added action. A named component (not an inline map body) so
// SpotifyPlaybackCover's premount state is owned once per row under the rules of
// hooks. Keyboard tab order per row: play button, then Add button.
function SongSuggestionRowItem({
	row,
	added,
	navigationDisabled,
	onAdd,
	onDismiss,
	isActive,
	onActivate,
	onDeactivate,
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
					<SpotifyPlaybackCover
						playbackId={song.id}
						spotifyTrackId={song.spotifyId}
						imageUrl={song.albumArtUrl}
						imageAlt={song.album ?? song.name}
						playLabel={`Play preview for ${song.name}`}
						size={48}
						isPlaybackActive={isActive}
						onActivate={onActivate}
						onDeactivate={onDeactivate}
					/>

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

				<div className="flex shrink-0 items-center gap-2">
					{onDismiss && !added && (
						<button
							type="button"
							disabled={navigationDisabled}
							onClick={() => onDismiss(song.id)}
							aria-label={`Dismiss song suggestion: ${song.name}`}
							className="theme-text-muted inline-flex size-8 cursor-pointer items-center justify-center rounded-full opacity-60 transition-opacity hover:opacity-100 disabled:pointer-events-none disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
						>
							<XIcon size={14} weight="bold" />
						</button>
					)}
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
	/** Drives the Reject button's singular/plural label (H3). */
	suggestionCount: number;
	onDismiss: () => void | Promise<void>;
	onPrevious?: () => void;
	onNext: () => void;
}

function SuggestionsControls({
	disabled,
	isLastItem,
	suggestionCount,
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
					{suggestionCount === 1 ? "Reject Match" : "Reject Matches"}
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
