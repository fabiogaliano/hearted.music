import {
	AnimatePresence,
	motion,
	useIsPresent,
	useReducedMotion,
} from "framer-motion";
import { memo, type ReactNode } from "react";
import { Cover } from "@/features/playlists/components/Cover";
import { fonts } from "@/lib/theme/fonts";
import type {
	PlaylistForMatching,
	PlaylistReviewItemSectionProps,
} from "../types";
import { usePlaylistTrackPreview } from "./usePlaylistTrackPreview";

// Match SongSection's ALBUM_SIZE constant so the left columns across both
// orientations stay visually consistent regardless of viewport size.
const COVER_SIZE = "min(100%, clamp(200px, 34vw, 620px), calc(56dvh - 40px))";

export const PlaylistReviewItemSection = memo(
	function PlaylistReviewItemSection({
		itemKey,
		reviewItem,
		canLoadTracks = true,
		suppressTransition,
	}: PlaylistReviewItemSectionProps) {
		const prefersReducedMotion = useReducedMotion();

		return (
			// min-w-0 lets this grid column shrink below its content's intrinsic width.
			// Without it a long unbreakable name token sets the column's min-content to
			// that full word, blowing the grid track past the grid width and pushing the
			// suggestions column off-screen (break-words on the name needs this to act).
			<div className="flex h-full min-w-0 flex-col">
				{/* initial={false}: the slide is a review-item transition, not a mount
				entrance. StaggeredContent owns the entrance so the panel doesn't slide
				in beside a static header on first render. */}
				<AnimatePresence mode="wait" initial={false}>
					<AnimatedPlaylistPanel
						key={itemKey}
						prefersReducedMotion={prefersReducedMotion ?? false}
						instant={suppressTransition ?? false}
					>
						<PlaylistCoverAndName
							reviewItem={reviewItem}
							canLoadTracks={canLoadTracks}
						/>
					</AnimatedPlaylistPanel>
				</AnimatePresence>
			</div>
		);
	},
);

interface PlaylistCoverAndNameProps {
	reviewItem: PlaylistForMatching;
	canLoadTracks: boolean;
}

// Separated so the hook is called exactly once per review item, matching how
// MatchRow in MatchesSection calls usePlaylistTrackPreview once per row.
function PlaylistCoverAndName({
	reviewItem,
	canLoadTracks,
}: PlaylistCoverAndNameProps) {
	const { triggerProps, preview } = usePlaylistTrackPreview({
		playlistId: reviewItem.id,
		songCount: reviewItem.trackCount,
		canLoadTracks,
	});

	// triggerProps bridges the cover + gap + name into one hover/focus region.
	// A single wrapper div receives them so the user can move between the cover
	// and the text without the preview closing. Keyboard users can tab to this
	// region and the same preview opens — no hover required (a11y parity).
	return (
		<>
			<div {...triggerProps} className="flex flex-col">
				<div
					className="relative aspect-square shrink-0 origin-top overflow-hidden"
					style={{ maxWidth: COVER_SIZE, width: COVER_SIZE }}
				>
					<Cover src={reviewItem.imageUrl} size="fill" />
					{/* 1px inset ring matches the SongSection album art treatment: adds
					subtle definition on light-colored or white covers in both themes. */}
					<div
						className="pointer-events-none absolute inset-0 z-20"
						style={{ boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.16)" }}
					/>
				</div>

				{/* mt-auto pins the text block to the column bottom so it aligns with
				the suggestion-section controls in the adjacent column, mirroring how
				SongSection anchors its title block. maxWidth ties the text to the cover's
				width (COVER_SIZE): the cover is capped well below the grid track, so
				without this the name + intent span the full track and sprawl toward the
				suggestions. Bounding them to the cover keeps the left column one coherent,
				left-aligned block.

				Structure mirrors SongSection's album / song / artist so the two review
				orientations read the same: a short uppercase label (track count, the
				playlist analog of the album eyebrow), the name as the headline, then the
				match intent as a readable sentence-case deck below it — not crammed into
				the label slot, where an ALL-CAPS, wide-tracked sentence became the least
				readable and, sitting above the name, out-ranked the playlist's own
				identity. */}
				<div
					className="mt-auto pt-[clamp(1rem,4dvh,2.5rem)]"
					style={{ maxWidth: COVER_SIZE }}
				>
					{reviewItem.trackCount != null && (
						<p
							className="theme-text-muted truncate text-[10px] tracking-[0.25em] uppercase opacity-70"
							style={{ fontFamily: fonts.body }}
						>
							{reviewItem.trackCount}{" "}
							{reviewItem.trackCount === 1 ? "song" : "songs"}
						</p>
					)}
					{/* break-words: playlist names can be a single spaceless token
					(e.g. "gaming+anime+vibez"). Without it that token can't wrap and
					overflows the grid track into the suggestions column. leading-[1.1]
					(over a flat 1) leaves room for serif descenders — at leading-[1] the
					card's overflow-hidden clips the tails of letters like g/y/p — and
					spaces the lines when a long name wraps. */}
					<h2
						className="theme-text mt-[clamp(0.75rem,2dvh,1rem)] text-[clamp(2.25rem,5.2dvh,3rem)] font-extralight break-words text-balance leading-[1.1]"
						style={{ fontFamily: fonts.display }}
					>
						{reviewItem.name}
					</h2>
					{/* The match intent — the user's stated purpose for the playlist, and
					the reason these suggestions exist. Shown in full as sentence-case body
					(italic, the brand's "key line quote" register), text-pretty to avoid a
					lone trailing word. Mirrors how the same intent reads in the match rows,
					just given more room as the review subject's defining line. */}
					{reviewItem.description && (
						<p
							className="theme-text-muted mt-[clamp(0.5rem,1.8dvh,1rem)] text-[clamp(0.95rem,2dvh,1.15rem)] text-pretty italic leading-snug"
							style={{ fontFamily: fonts.body }}
						>
							{reviewItem.description}
						</p>
					)}
				</div>
			</div>
			{preview}
		</>
	);
}

interface AnimatedPlaylistPanelProps {
	prefersReducedMotion: boolean;
	/** Skip the slide and swap immediately — see SongSectionProps.suppressTransition. */
	instant?: boolean;
	children: ReactNode;
}

function AnimatedPlaylistPanel({
	prefersReducedMotion,
	instant,
	children,
}: AnimatedPlaylistPanelProps) {
	// Exiting copies remain mounted briefly under AnimatePresence mode="wait";
	// disable pointer events so stale DOM cannot receive hover/focus events.
	const isPresent = useIsPresent();
	const skip = instant || prefersReducedMotion;
	return (
		// min-w-0: this is the flex item inside the column's flex-col, so it must
		// also be allowed to shrink for the nowrap description to truncate.
		<motion.div
			className="min-w-0"
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
