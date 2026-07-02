import { XIcon } from "@phosphor-icons/react";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
	AnimatePresence,
	motion,
	useIsPresent,
	useReducedMotion,
} from "framer-motion";
import {
	memo,
	type ReactNode,
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { CoverPeekBadge } from "@/components/ui/CoverPeekBadge";
import { Cover } from "@/features/playlists/components/Cover";
import { TrackList } from "@/features/playlists/components/TrackList";
import type { PlaylistTrackVM } from "@/features/playlists/components/types";
import { playlistTracksInfiniteQueryOptions } from "@/features/playlists/queries";
import { fonts } from "@/lib/theme/fonts";
import type {
	PlaylistForMatching,
	PlaylistReviewItemSectionProps,
} from "../types";

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
// MatchRow in MatchesSection calls its preview hook once per row.
function PlaylistCoverAndName({
	reviewItem,
	canLoadTracks,
}: PlaylistCoverAndNameProps) {
	const prefersReducedMotion = useReducedMotion();
	const panelId = useId();
	const [showTracks, setShowTracks] = useState(false);
	// Rows stagger in on the first reveal only; re-opening the list shows it at
	// once so a repeated open doesn't replay the whole ripple every time.
	const [animateRows, setAnimateRows] = useState(true);
	const staggeredRef = useRef(false);
	// Focus follows the swap: into the panel's Close on expand, back to the cover
	// on collapse. `interacted` skips the very first commit so we don't steal focus
	// on mount (showTracks starts closed).
	const coverRef = useRef<HTMLButtonElement>(null);
	const closeRef = useRef<HTMLButtonElement>(null);
	const interacted = useRef(false);

	// Playlist mode is the single review subject, so its tracks are almost
	// certainly wanted — load the first page eagerly (enabled the moment the id is
	// non-null) so the morph reveals a populated list, not a spinner. Demo mode
	// (canLoadTracks false) passes null and stays disabled.
	const tracksQuery = useInfiniteQuery(
		playlistTracksInfiniteQueryOptions(canLoadTracks ? reviewItem.id : null),
	);
	const tracks = useMemo<PlaylistTrackVM[]>(
		() =>
			(tracksQuery.data?.pages.flatMap((page) => page.tracks) ?? []).map(
				(t) => ({
					position: t.position,
					name: t.name,
					artists: t.artists,
					albumName: t.albumName,
					imageUrl: t.imageUrl,
				}),
			),
		[tracksQuery.data],
	);
	const loadMoreTracks = useCallback(() => {
		if (tracksQuery.hasNextPage && !tracksQuery.isFetchingNextPage)
			void tracksQuery.fetchNextPage();
	}, [tracksQuery]);
	const total = reviewItem.trackCount ?? tracks.length;

	const expand = useCallback(() => {
		interacted.current = true;
		setAnimateRows(!staggeredRef.current);
		staggeredRef.current = true;
		setShowTracks(true);
	}, []);
	const collapse = useCallback(() => {
		interacted.current = true;
		setShowTracks(false);
	}, []);

	useEffect(() => {
		if (!interacted.current) return;
		(showTracks ? closeRef.current : coverRef.current)?.focus();
	}, [showTracks]);

	useEffect(() => {
		if (!showTracks) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.stopPropagation();
			collapse();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [showTracks, collapse]);

	const count = reviewItem.trackCount;
	const countLabel =
		count != null ? `${count} ${count === 1 ? "song" : "songs"}` : null;

	// The cover carries the shared peek badge (the same glyph + count signifier
	// song rows use, same corner) as a resting hint that the art opens the track
	// list. Clicking the cover morphs it, in place, into the track list — reusing
	// the popover's own fade+scale reveal so nothing new is invented — and a Close
	// button in the panel flips it back to the art. The count lives only on the
	// badge (TrackList prints its own header), so nothing repeats it.
	return (
		<div className="flex flex-col">
			<div
				className="relative aspect-square shrink-0 overflow-hidden"
				style={{ maxWidth: COVER_SIZE, width: COVER_SIZE }}
			>
				<AnimatePresence initial={false}>
					{showTracks ? (
						<motion.div
							key="tracks"
							id={panelId}
							role="region"
							aria-label={`Tracks in ${reviewItem.name}`}
							className="theme-surface-bg absolute inset-0 flex flex-col p-4"
							initial={
								prefersReducedMotion
									? { opacity: 0 }
									: { opacity: 0, scale: 0.97 }
							}
							animate={{
								opacity: 1,
								scale: 1,
								transition: {
									duration: 0.18,
									ease: [0.165, 0.84, 0.44, 1],
								},
							}}
							exit={
								prefersReducedMotion
									? { opacity: 0, transition: { duration: 0.1 } }
									: {
											opacity: 0,
											scale: 0.98,
											transition: {
												duration: 0.14,
												ease: [0.165, 0.84, 0.44, 1],
											},
										}
							}
							style={{ willChange: "transform" }}
						>
							{/* No count header here: TrackList prints its own "Tracks N",
							so a second label just duplicated it. Close floats in the corner
							(on a surface chip so it stays legible over scrolling rows)
							instead of claiming a whole row. */}
							<button
								ref={closeRef}
								type="button"
								onClick={collapse}
								aria-label="Show cover art"
								className="theme-text-muted absolute top-2 right-2 z-10 inline-flex size-8 cursor-pointer items-center justify-center rounded-full opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
								style={{
									background:
										"color-mix(in srgb, var(--t-surface) 80%, transparent)",
								}}
							>
								<XIcon size={16} weight="bold" />
							</button>
							<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
								{tracksQuery.isLoading ? (
									<p
										className="theme-text-muted text-xs"
										style={{ fontFamily: fonts.body }}
									>
										Loading tracks…
									</p>
								) : tracks.length > 0 ? (
									<TrackList
										tracks={tracks}
										songCount={total}
										hasMore={tracksQuery.hasNextPage}
										isLoadingMore={tracksQuery.isFetchingNextPage}
										onLoadMore={loadMoreTracks}
										animateIn={animateRows}
										hideAlbum
										hideEmptyState
									/>
								) : (
									<p
										className="theme-text-muted text-xs"
										style={{ fontFamily: fonts.body }}
									>
										No tracks to preview yet.
									</p>
								)}
							</div>
						</motion.div>
					) : (
						<motion.div
							key="cover"
							className="absolute inset-0"
							initial={
								prefersReducedMotion
									? { opacity: 0 }
									: { opacity: 0, scale: 0.97 }
							}
							animate={{
								opacity: 1,
								scale: 1,
								transition: {
									duration: 0.18,
									ease: [0.165, 0.84, 0.44, 1],
								},
							}}
							exit={
								prefersReducedMotion
									? { opacity: 0, transition: { duration: 0.1 } }
									: {
											opacity: 0,
											scale: 0.98,
											transition: {
												duration: 0.14,
												ease: [0.165, 0.84, 0.44, 1],
											},
										}
							}
							style={{ willChange: "transform" }}
						>
							{canLoadTracks ? (
								<button
									ref={coverRef}
									type="button"
									onClick={expand}
									aria-expanded={showTracks}
									aria-controls={showTracks ? panelId : undefined}
									aria-label={
										countLabel
											? `Show track list — ${countLabel}`
											: "Show track list"
									}
									className="group/cover relative block size-full cursor-pointer overflow-hidden border-0 bg-transparent p-0 text-left transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] motion-safe:active:scale-[0.99]"
								>
									<Cover src={reviewItem.imageUrl} size="fill" />
									<CoverRing />
									<CoverPeekBadge
										size={26}
										label={countLabel ?? undefined}
										className="z-30 transition-transform duration-200 group-hover/cover:scale-110"
									/>
								</button>
							) : (
								// Demo mode can't open a track list, so the badge is static (no
								// hover lift) — but it still carries the count so the cover reads
								// the same as the live one.
								<div className="relative size-full">
									<Cover src={reviewItem.imageUrl} size="fill" />
									<CoverRing />
									{countLabel && (
										<CoverPeekBadge
											size={26}
											label={countLabel}
											className="z-30"
										/>
									)}
								</div>
							)}
						</motion.div>
					)}
				</AnimatePresence>
			</div>

			{/* mt-auto pins the text block to the column bottom so it aligns with
			the suggestion-section controls in the adjacent column, mirroring how
			SongSection anchors its title block. maxWidth ties the text to the cover's
			width (COVER_SIZE): the cover is capped well below the grid track, so
			without this the name + intent span the full track and sprawl toward the
			suggestions. Bounding them to the cover keeps the left column one coherent,
			left-aligned block. The track count lives on the cover badge (not an
			eyebrow here) so it isn't printed twice, leaving name → intent. */}
			<div
				className="mt-auto pt-[clamp(1rem,4dvh,2.5rem)]"
				style={{ maxWidth: COVER_SIZE }}
			>
				{/* break-words: playlist names can be a single spaceless token
				(e.g. "gaming+anime+vibez"). Without it that token can't wrap and
				overflows the grid track into the suggestions column. leading-[1.1]
				(over a flat 1) leaves room for serif descenders — at leading-[1] the
				card's overflow-hidden clips the tails of letters like g/y/p — and
				spaces the lines when a long name wraps. */}
				<h2
					className="theme-text text-[clamp(2.25rem,5.2dvh,3rem)] font-extralight break-words text-balance leading-[1.1]"
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
	);
}

// 1px inset ring matches the SongSection album art treatment: adds subtle
// definition on light-colored or white covers in both themes.
function CoverRing() {
	return (
		<div
			className="pointer-events-none absolute inset-0 z-20"
			style={{ boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.16)" }}
		/>
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
