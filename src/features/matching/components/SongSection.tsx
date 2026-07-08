import {
	AnimatePresence,
	motion,
	useIsPresent,
	useReducedMotion,
} from "framer-motion";
import { memo, type ReactNode } from "react";
import { SpotifyPlaybackCover } from "@/features/playback/SpotifyPlaybackCover";
import { useSingleActivePlayback } from "@/features/playback/useSingleActivePlayback";
import { fonts } from "@/lib/theme/fonts";

// The dvh term caps the art by viewport height so the whole card (art + title +
// matches + controls) stays reachable without scrolling on short viewports; on
// tall screens 34vw wins and the size is unchanged. The -40px reserves vertical
// room so the bottom controls (Next Song) clear the fixed feedback launcher
// (size-10 @ right-6/bottom-6 → a 64px bottom-right corner) instead of sliding
// under it when the card fills a short viewport. 34vw/56dvh (up from 30vw/50dvh)
// grows the art toward the column edge on a laptop, closing the dead band that
// sat between the height-capped square and the wider grid track.
const ALBUM_SIZE = "min(100%, clamp(200px, 34vw, 620px), calc(56dvh - 40px))";

interface SongSectionProps {
	song: {
		name: string;
		album: string;
		artist: string;
	};
	albumArtUrl?: string;
	songKey?: string;
	spotifyId?: string;
	/** Swap songs instantly (no slide) — the card-level reject animation owns the
	 *  motion while it's flying off, so the inner slide must stay out of its way. */
	suppressTransition?: boolean;
}

export const SongSection = memo(function SongSection({
	song,
	albumArtUrl,
	songKey,
	spotifyId,
	suppressTransition,
}: SongSectionProps) {
	const prefersReducedMotion = useReducedMotion();
	// Single review subject, so there's just one cover — but route it through the
	// shared coordinator keyed by songKey so the preview stops when the song swaps.
	const { activePlaybackId, activatePlayback, deactivatePlayback } =
		useSingleActivePlayback(songKey);

	return (
		<div className="flex h-full flex-col">
			{/* initial={false}: the slide is a song-to-song transition, not an entrance.
			Suppressing it on mount lets the composition-level StaggeredContent own the
			entrance so the panel no longer slides in beside a static header. */}
			<AnimatePresence mode="wait" initial={false}>
				<AnimatedSongPanel
					key={songKey}
					prefersReducedMotion={prefersReducedMotion ?? false}
					instant={suppressTransition ?? false}
				>
					<SpotifyPlaybackCover
						playbackId="song"
						spotifyTrackId={spotifyId}
						imageUrl={albumArtUrl}
						imageAlt={song.album}
						playLabel="Play preview"
						size={ALBUM_SIZE}
						isPlaybackActive={activePlaybackId === "song"}
						onActivate={activatePlayback}
						onDeactivate={deactivatePlayback}
						playButtonSize={64}
						playIconSize={22}
						closeIconSize={28}
						closeInset="1.5rem"
						className="origin-top"
					/>

					{/* mt-auto pins the title block to the column bottom so it aligns
					with the matches controls (Dismiss/Next) in the adjacent column,
					which pin to their own bottom. The dvh-based type/margin clamps
					shrink the block on short viewports so the card fits without
					scrolling. */}
					{/* maxWidth ties the title block to the album art's width (ALBUM_SIZE),
					mirroring the playlist column, so the title/artist stay a coherent
					left-aligned block under the art rather than spanning the full track. */}
					<div
						className="mt-auto pt-[clamp(1rem,4dvh,2.5rem)]"
						style={{ maxWidth: ALBUM_SIZE }}
					>
						<p
							className="theme-text-muted truncate text-[10px] tracking-[0.25em] uppercase opacity-70"
							style={{ fontFamily: fonts.body }}
						>
							{song.album}
						</p>
						{/* break-words keeps a long unbreakable title from overflowing the
						grid track into the matches column; leading-[1.1] leaves room for
						serif descenders (else overflow-hidden clips g/y/p tails) and spaces
						wrapped lines — mirrors the playlist name. */}
						<h2
							className="theme-text mt-[clamp(0.75rem,2dvh,1rem)] text-[clamp(2.25rem,5.2dvh,3rem)] font-extralight break-words text-balance leading-[1.1]"
							style={{ fontFamily: fonts.display }}
						>
							{song.name}
						</h2>
						<p
							className="theme-text-muted mt-[clamp(0.5rem,1.8dvh,1rem)] text-[clamp(1.05rem,2.4dvh,1.25rem)] italic"
							style={{ fontFamily: fonts.display }}
						>
							{song.artist}
						</p>
					</div>
				</AnimatedSongPanel>
			</AnimatePresence>
		</div>
	);
});

interface AnimatedSongPanelProps {
	prefersReducedMotion: boolean;
	/** Skip the slide and swap immediately — see SongSectionProps.suppressTransition. */
	instant?: boolean;
	children: ReactNode;
}

function AnimatedSongPanel({
	prefersReducedMotion,
	instant,
	children,
}: AnimatedSongPanelProps) {
	// Exiting copies remain mounted briefly under AnimatePresence mode="wait";
	// disable pointer events so stale DOM cannot receive clicks.
	const isPresent = useIsPresent();
	const skip = instant || prefersReducedMotion;
	return (
		<motion.div
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
