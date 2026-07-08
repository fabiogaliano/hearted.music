import { motion, useAnimationControls, useReducedMotion } from "framer-motion";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useSingleActivePlayback } from "@/features/playback/useSingleActivePlayback";
import { MatchesSection } from "../components/MatchesSection";
import { PlaylistReviewItemSection } from "../components/PlaylistReviewItemSection";
import { SongSection } from "../components/SongSection";
import { SongSuggestionsSection } from "../components/SongSuggestionsSection";
import type { MatchingSessionProps } from "../types";

// The card's resting transform. Doubles as the motion element's `initial` so it
// renders here on mount without an entrance (StaggeredContent owns that) and
// gives `filter` a tracked baseline so grayscale can interpolate later.
const CARD_AT_REST = {
	x: 0,
	rotate: 0,
	scale: 1,
	opacity: 1,
	filter: "grayscale(0)",
} as const;

const EASE_OUT_QUART = [0.165, 0.84, 0.44, 1] as const;

export function MatchingSession(props: MatchingSessionProps) {
	const {
		addedTo,
		isDemo,
		realAvailable,
		reconnectNeeded,
		navigationDisabled,
		isLastItem,
		animateReject,
		onRefresh,
		onAdd,
		onDismissSuggestion,
		onDismiss,
		onNext,
		onPrevious,
	} = props;

	// Mode-specific values extracted before useMemo to avoid conditional hook calls.
	const songId = props.mode === "song" ? props.currentSong.id : "";
	const songName = props.mode === "song" ? props.currentSong.name : "";
	const songAlbum =
		props.mode === "song" ? (props.currentSong.album ?? "") : "";
	const songArtist = props.mode === "song" ? props.currentSong.artist : "";
	const songAlbumArtUrl =
		props.mode === "song"
			? (props.currentSong.albumArtUrl ?? undefined)
			: undefined;
	const songSpotifyId =
		props.mode === "song" ? props.currentSong.spotifyId : undefined;
	const playlists = props.mode === "song" ? props.playlists : [];
	const songSuggestions = props.mode === "playlist" ? props.suggestions : [];

	// One preview at a time across *both* playlist-mode columns: the track list on
	// the left and the suggestions on the right share this coordinator, so playing a
	// track pauses a suggestion's iframe and vice versa. Keyed by the review subject
	// so navigating to a new item drops the active preview before the columns repaint.
	const reviewSubjectId =
		props.mode === "playlist" ? props.reviewItem.id : songId;
	const playback = useSingleActivePlayback(reviewSubjectId);

	const song = useMemo(
		() => ({
			name: songName,
			album: songAlbum,
			artist: songArtist,
		}),
		[songName, songAlbum, songArtist],
	);

	const topGridRef = useRef<HTMLDivElement>(null);
	const wrapperRef = useRef<HTMLDivElement>(null);

	useLayoutEffect(() => {
		const wrapper = wrapperRef.current;
		const inner = topGridRef.current;
		if (!wrapper || !inner) return;

		const observer = new ResizeObserver((entries) => {
			for (const entry of entries) {
				wrapper.style.height = `${entry.contentRect.height}px`;
			}
		});

		observer.observe(inner);
		return () => observer.disconnect();
	}, []);

	const prefersReducedMotion = useReducedMotion();
	const cardControls = useAnimationControls();
	// While a reject is in flight the whole card is the moving thing; the panels'
	// own song-to-song slide is suppressed so it can't fire (invisibly) under the
	// flying card and surface a half-swapped frame when the next card settles in.
	const [rejecting, setRejecting] = useState(false);

	const handleReject = useCallback(async () => {
		// Guard re-entry: the card is already mid-throw.
		if (rejecting) return;
		setRejecting(true);

		// Throw the card and fire the real dismiss together. The animation gives
		// instant feedback on the click; the dismiss (server round-trip + advance to
		// the next card) runs in parallel so we're not waiting on the network to move.
		// Promise.resolve tolerates a sync onDismiss (e.g. a non-advancing caller).
		const dismissed = Promise.resolve(onDismiss());

		// finally: always drop the flag, even if an animation promise rejects on an
		// interrupt (e.g. unmount mid-flight). A stuck `rejecting` would otherwise
		// also freeze the panels' normal song-to-song slide.
		try {
			if (prefersReducedMotion) {
				await cardControls.start({
					opacity: 0,
					transition: { duration: 0.18, ease: EASE_OUT_QUART },
				});
				await dismissed;
				cardControls.set({ ...CARD_AT_REST, opacity: 0 });
				await cardControls.start({
					opacity: 1,
					transition: { duration: 0.18, ease: EASE_OUT_QUART },
				});
				return;
			}

			// Fling left with a trailing tilt, draining to grayscale as it leaves — the
			// rejection read, kept to the design tokens (no color, just desaturation).
			await cardControls.start({
				x: "-120%",
				rotate: -14,
				scale: 0.9,
				opacity: 0,
				filter: "grayscale(1)",
				transition: { duration: 0.55, ease: EASE_OUT_QUART },
			});

			// Wait for the next card to be in place (or, on a failed dismiss, the same
			// card) before revealing — the inner swap is instant while rejecting.
			await dismissed;

			// Bring the next card forward from slightly behind, the way a stacked card
			// rises once the one on top is gone.
			cardControls.set({ ...CARD_AT_REST, scale: 0.94, opacity: 0 });
			await cardControls.start({
				scale: 1,
				opacity: 1,
				transition: { duration: 0.4, ease: EASE_OUT_QUART },
			});
		} finally {
			setRejecting(false);
		}
	}, [rejecting, onDismiss, cardControls, prefersReducedMotion]);

	return (
		<div
			ref={wrapperRef}
			className="origin-top overflow-hidden will-change-[height]"
		>
			<div
				ref={topGridRef}
				className="origin-top transition-transform duration-300 ease-in-out"
			>
				<motion.div initial={CARD_AT_REST} animate={cardControls}>
					{props.mode === "song" ? (
						<div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
							<SongSection
								songKey={songId}
								song={song}
								albumArtUrl={songAlbumArtUrl}
								spotifyId={songSpotifyId}
								suppressTransition={rejecting}
							/>
							<MatchesSection
								songKey={songId}
								playlists={playlists}
								addedTo={addedTo}
								isDemo={isDemo}
								realAvailable={realAvailable}
								reconnectNeeded={reconnectNeeded}
								navigationDisabled={navigationDisabled}
								isLastItem={isLastItem}
								suppressTransition={rejecting}
								onRefresh={onRefresh}
								onAdd={onAdd}
								onDismissSuggestion={onDismissSuggestion}
								onDismiss={animateReject ? handleReject : onDismiss}
								onNext={onNext}
								onPrevious={onPrevious}
							/>
						</div>
					) : (
						<div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
							<PlaylistReviewItemSection
								itemKey={props.reviewItem.id}
								reviewItem={props.reviewItem}
								canLoadTracks={!isDemo}
								suppressTransition={rejecting}
								playback={playback}
							/>
							<SongSuggestionsSection
								itemKey={props.reviewItem.id}
								suggestions={songSuggestions}
								playback={playback}
								addedTo={addedTo}
								navigationDisabled={navigationDisabled}
								isLastItem={isLastItem}
								suppressTransition={rejecting}
								suggestionTotal={props.suggestionTotal}
								hasMoreSuggestions={props.hasMoreSuggestions}
								isLoadingMoreSuggestions={props.isLoadingMoreSuggestions}
								loadMoreSuggestions={props.loadMoreSuggestions}
								loadMoreError={props.loadMoreError}
								retryLoadMore={props.retryLoadMore}
								onAdd={onAdd}
								onDismissSuggestion={onDismissSuggestion}
								onDismiss={animateReject ? handleReject : onDismiss}
								onNext={onNext}
								onPrevious={onPrevious}
							/>
						</div>
					)}
				</motion.div>
			</div>
		</div>
	);
}
