import { XIcon } from "@phosphor-icons/react";
import { AnimatePresence, useReducedMotion } from "framer-motion";
import { memo } from "react";
import { Button } from "@/components/ui/Button";
import { SpotifyPlaybackCover } from "@/features/playback/SpotifyPlaybackCover";
import { useSingleActivePlayback } from "@/features/playback/useSingleActivePlayback";
import { AccountMismatchPrompt } from "@/features/playlists/create/publish/AccountMismatchPrompt";
import { useInfiniteScroll } from "@/lib/hooks/useInfiniteScroll";
import { fonts } from "@/lib/theme/fonts";
import type { SongSuggestionRow, SongSuggestionsSectionProps } from "../types";
import {
	AnimatedReviewPanel,
	ReconnectBanner,
	ReviewColumnFrame,
	ReviewControls,
	ReviewEmptyState,
} from "./ReviewColumn";
import { ReviewListScroll } from "./ReviewListScroll";

// Playlist-mode review column: thin adapter over ReviewColumn's shared
// layout/animation/controls. Its rows and preview interaction (single-active
// song playback via useSingleActivePlayback + SpotifyPlaybackCover) are a
// genuinely different feature from song-mode's playlist track-list disclosure
// (usePlaylistTrackPreview) — this plays the suggested song's own audio
// preview, that discloses a *playlist's* track list — so they stay
// per-variant rather than merged. See
// docs/architecture/audits/deepening-opportunities-2026-07-02.md for the
// shared/variant split this was extracted from.
export const SongSuggestionsSection = memo(function SongSuggestionsSection({
	itemKey,
	suggestions,
	playback,
	addedTo,
	mismatchProfile,
	reconnectNeeded,
	navigationDisabled,
	isLastItem,
	suppressTransition,
	// Tail-paging state driving the sentinel/retry footer rendered in
	// ReviewListScroll.
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
		<ReviewColumnFrame>
			<div aria-live="polite" aria-atomic="true" className="sr-only">
				{liveAnnouncement}
			</div>

			{/* initial={false}: slide is a review-item transition, not a mount
			entrance. StaggeredContent owns the entrance so the panel doesn't slide
			in beside a static header on first render. */}
			<AnimatePresence mode="wait" initial={false}>
				<AnimatedReviewPanel
					key={itemKey}
					prefersReducedMotion={prefersReducedMotion ?? false}
					instant={suppressTransition ?? false}
				>
					{/* Same heading as song mode. The two used to read "Best Matches" and
					"Song Suggestions" — one slot, two grammars, a quality claim beside a
					content type — so switching orientation made the column look like it
					had changed job when only its contents had. */}
					<p
						className="theme-text-muted text-xs tracking-widest uppercase"
						style={{ fontFamily: fonts.body }}
					>
						Best matches
					</p>

					{reconnectNeeded && <ReconnectBanner />}

					<ReviewListScroll footer={suggestionsFooter}>
						{mismatchProfile ? (
							// Invariant 2: block every row's Add rather than a per-row
							// swap — mirrors MatchesSection's song-mode treatment and
							// the studio CreateBar's account-mismatch gate state, one
							// prompt/copy reused across every surface.
							<AccountMismatchPrompt
								extensionProfile={mismatchProfile}
								accountDisplayName={null}
							/>
						) : suggestions.length === 0 && !hasMoreSuggestions ? (
							<ReviewEmptyState />
						) : (
							suggestions.map((row) => (
								<SongSuggestionRowItem
									key={row.song.id}
									row={row}
									added={addedTo.includes(row.song.id)}
									// Add stays visible but inert while the token is dead — the
									// suggestion is still real, and the banner above says why it
									// can't be acted on yet.
									navigationDisabled={
										(navigationDisabled ?? false) || (reconnectNeeded ?? false)
									}
									onAdd={onAdd}
									onDismiss={onDismissSuggestion}
									isActive={activePlaybackId === row.song.id}
									onActivate={activatePlayback}
									onDeactivate={deactivatePlayback}
								/>
							))
						)}
					</ReviewListScroll>
				</AnimatedReviewPanel>
			</AnimatePresence>

			{/* Lives outside the keyed AnimatePresence subtree so it always renders
			against the latest committed review item. Stale DOM from the exiting
			panel cannot intercept rapid Next clicks. */}
			<ReviewControls
				disabled={navigationDisabled ?? false}
				isLastItem={isLastItem ?? false}
				nextLabel="Skip Playlist"
				onDismiss={onDismiss}
				onPrevious={onPrevious}
				onNext={onNext}
			/>
		</ReviewColumnFrame>
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
	// fitScore stays on the row type — it's what the list is ordered by — but
	// nothing prints it any more.
	const { song } = row;

	return (
		// Same evolved row as the song-mode column (see PlaylistMatchRow): no
		// hairline, transparent at rest, one hover plane binding the row's three
		// controls — play, dismiss, Add.
		<div className="surface-raised-hover squircle rounded-[10px] px-2.5 py-3 transition-[background-color] duration-150 ease-out">
			{/* Opens on the cover, mirroring song mode: the fit percentage that used
			to hold this position claimed a precision the ranking can't defend, and
			the list is ordered by score, so position already carries it. */}
			<div className="flex items-center gap-6">
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
							className="theme-text-muted tap-40 inline-flex size-8 cursor-pointer items-center justify-center rounded-full opacity-60 transition-opacity hover:opacity-100 disabled:pointer-events-none disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
						>
							<XIcon size={14} weight="bold" />
						</button>
					)}
					{added ? (
						<span
							className="theme-text-muted text-xs tracking-widest uppercase opacity-60"
							style={{ fontFamily: fonts.body }}
						>
							Found its home
						</span>
					) : (
						// Accent fill, matching song mode's Add — see PlaylistMatchRow for
						// why a raised chip converges with its own row's hover.
						<Button
							variant="primary"
							size="sm"
							className="squircle rounded-full"
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
