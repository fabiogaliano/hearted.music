import { PlayIcon, XIcon } from "@phosphor-icons/react";
import {
	AnimatePresence,
	motion,
	useIsPresent,
	useReducedMotion,
} from "framer-motion";
import { memo, type ReactNode, useEffect, useRef, useState } from "react";
import { AlbumPlaceholder } from "@/components/ui/AlbumPlaceholder";
import { fonts } from "@/lib/theme/fonts";
import {
	preloadSpotifyEmbedAPI,
	SpotifyEmbedIframe,
} from "./SpotifyEmbedIframe";

// The dvh term caps the art by viewport height so the whole card (art + title +
// matches + controls) stays reachable without scrolling on short viewports; on
// tall screens 30vw wins and the size is unchanged. The -40px reserves vertical
// room so the bottom controls (Next Song) clear the fixed feedback launcher
// (size-10 @ right-6/bottom-6 → a 64px bottom-right corner) instead of sliding
// under it when the card fills a short viewport.
const ALBUM_SIZE = "min(100%, clamp(200px, 30vw, 560px), calc(50dvh - 40px))";

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
					<AlbumWithPlayer
						album={song.album}
						albumArtUrl={albumArtUrl}
						spotifyId={spotifyId}
					/>

					{/* mt-auto pins the title block to the column bottom so it aligns
					with the matches controls (Dismiss/Next) in the adjacent column,
					which pin to their own bottom. The dvh-based type/margin clamps
					shrink the block on short viewports so the card fits without
					scrolling. */}
					<div className="mt-auto pt-[clamp(1rem,4dvh,2.5rem)]">
						<p
							className="theme-text-muted truncate text-[10px] tracking-[0.25em] uppercase opacity-70"
							style={{ fontFamily: fonts.body }}
						>
							{song.album}
						</p>
						<h2
							className="theme-text mt-[clamp(0.75rem,2dvh,1rem)] text-[clamp(2.25rem,5.2dvh,3rem)] font-extralight text-balance leading-[1]"
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

interface AlbumWithPlayerProps {
	album: string;
	albumArtUrl?: string;
	spotifyId?: string;
}

function AlbumWithPlayer({
	album,
	albumArtUrl,
	spotifyId,
}: AlbumWithPlayerProps) {
	const [activated, setActivated] = useState(false);
	const [premounted, setPremounted] = useState(false);
	const premountTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const canPreview = Boolean(spotifyId);

	useEffect(() => {
		return () => {
			if (premountTimeoutRef.current) clearTimeout(premountTimeoutRef.current);
		};
	}, []);

	const cancelPremount = () => {
		if (premountTimeoutRef.current) {
			clearTimeout(premountTimeoutRef.current);
			premountTimeoutRef.current = null;
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
		// Avoid iframe work for drive-by pointer movement while keeping deliberate
		// hover/focus effectively instant.
		premountTimeoutRef.current = setTimeout(() => {
			setPremounted(true);
			premountTimeoutRef.current = null;
		}, delayMs);
	};

	const handlePreviewIntent = () => warmPreview(50);

	const handlePreviewLeave = () => cancelPremount();

	const handleActivate = () => {
		warmPreview(0);
		setActivated(true);
	};

	const showIframe = canPreview && spotifyId && (premounted || activated);

	return (
		<div
			className="relative aspect-square shrink-0 origin-top overflow-hidden"
			style={{
				maxWidth: ALBUM_SIZE,
				width: ALBUM_SIZE,
			}}
		>
			{!activated &&
				(albumArtUrl ? (
					<img
						src={albumArtUrl}
						alt={album}
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
					onClick={handleActivate}
					onPointerEnter={handlePreviewIntent}
					onPointerDown={() => warmPreview(0)}
					onPointerLeave={handlePreviewLeave}
					onFocus={handlePreviewIntent}
					onBlur={handlePreviewLeave}
					className="group absolute inset-0 z-10 flex cursor-pointer items-center justify-center bg-black/10 transition-colors duration-200 hover:bg-black/35 focus-visible:bg-black/35 focus-visible:outline-none motion-safe:active:scale-[0.96]"
					aria-label="Play preview"
				>
					<span className="theme-primary flex size-16 items-center justify-center rounded-full bg-white/70 shadow-md [transition:transform_200ms_cubic-bezier(0.165,0.84,0.44,1),background-color_500ms_ease-out] group-hover:scale-110 group-hover:bg-white group-focus-visible:scale-110 group-focus-visible:bg-white group-focus-visible:ring-2 group-focus-visible:ring-[var(--ring)] group-focus-visible:ring-inset">
						<PlayIcon size={22} weight="fill" style={{ marginLeft: 2 }} />
					</span>
				</button>
			)}

			{showIframe && spotifyId && (
				<motion.div
					className="absolute inset-0"
					initial={{ opacity: 0 }}
					animate={{
						opacity: activated ? 1 : 0,
						transition: { duration: 0.25, ease: [0.165, 0.84, 0.44, 1] },
					}}
					style={{ pointerEvents: activated ? "auto" : "none" }}
				>
					<SpotifyEmbedIframe spotifyId={spotifyId} playWhenReady={activated} />
					{activated && (
						<button
							type="button"
							onClick={() => setActivated(false)}
							aria-label="Close preview"
							className="absolute top-6 left-6 z-10 cursor-pointer text-white opacity-90 drop-shadow-md transition-opacity duration-200 hover:opacity-100 motion-safe:active:scale-[0.96]"
						>
							<XIcon size={28} weight="bold" />
						</button>
					)}
				</motion.div>
			)}

			<div
				className="pointer-events-none absolute inset-0 z-20"
				style={{ boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.16)" }}
			/>
		</div>
	);
}
