import { PlayIcon, XIcon } from "@phosphor-icons/react";
import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { AlbumPlaceholder } from "@/components/ui/AlbumPlaceholder";
import { prepareSpotifyEmbed, SpotifyEmbedIframe } from "./SpotifyEmbedIframe";

interface SpotifyPlaybackCoverProps {
	/** Stable id for this cover, used by the parent to track which one is active. */
	playbackId: string;
	/** Spotify track id. Absent → renders a plain, non-playable cover. */
	spotifyTrackId?: string | null;
	imageUrl?: string | null;
	imageAlt: string;
	/** Accessible label for the play button, e.g. `Play ${song.name}`. */
	playLabel: string;
	/** Box edge: a px number, or a CSS length (responsive covers add aspect-square). */
	size: number | string;
	/** True when this cover is the single active preview (owned by the parent list). */
	isPlaybackActive: boolean;
	onActivate: (playbackId: string) => void;
	onDeactivate: () => void;
	className?: string;
	/** Play-glyph circle diameter in px (default 32, matching the 48px cover). */
	playButtonSize?: number;
	/** Play icon size in px (default 14). */
	playIconSize?: number;
	/** Close (✕) icon size in px (default 14). */
	closeIconSize?: number;
	/** Inset of the close button from the top-left corner (default "0.25rem"). */
	closeInset?: number | string;
}

/**
 * Album/track art with a Spotify play overlay, driven by the same Iframe Embed
 * engine everywhere. Controlled: the parent owns `isPlaybackActive` (via
 * useSingleActivePlayback) so only one cover plays at a time. Premount/warm-up is
 * local — warming an iframe is independent of which cover is currently playing —
 * so hovering or focusing a cover starts the embed download before the click and
 * playback feels instant once activated.
 */
export function SpotifyPlaybackCover({
	playbackId,
	spotifyTrackId,
	imageUrl,
	imageAlt,
	playLabel,
	size,
	isPlaybackActive,
	onActivate,
	onDeactivate,
	className,
	playButtonSize = 32,
	playIconSize = 14,
	closeIconSize = 14,
	closeInset = "0.25rem",
}: SpotifyPlaybackCoverProps) {
	const [premounted, setPremounted] = useState(false);
	const premountTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const canPreview = Boolean(spotifyTrackId);

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

	// Mounting the embed creates a live Spotify iframe that only unmounting frees,
	// so a premount must not outlive the hover/focus that asked for it — otherwise
	// every cover a user ever grazes in a long list keeps its iframe alive. Cooling
	// on leave bounds live iframes to the hovered row (plus the active one).
	const coolPreview = () => {
		cancelPremount();
		setPremounted(false);
	};

	const warmPreview = (delayMs: 0 | 50) => {
		prepareSpotifyEmbed();
		if (premounted) return;
		cancelPremount();
		if (delayMs === 0) {
			setPremounted(true);
			return;
		}
		// Brief delay filters incidental pointer movement from deliberate hover so a
		// drive-by sweep across a list doesn't premount every iframe it grazes.
		premountTimerRef.current = setTimeout(() => {
			setPremounted(true);
			premountTimerRef.current = null;
		}, delayMs);
	};

	const isNumericSize = typeof size === "number";
	const showIframe =
		canPreview && spotifyTrackId && (premounted || isPlaybackActive);

	return (
		<div
			className={`relative shrink-0 overflow-hidden ${
				isNumericSize ? "" : "aspect-square"
			} ${className ?? ""}`}
			style={
				isNumericSize
					? { width: size, height: size }
					: { width: size, maxWidth: size }
			}
		>
			{!isPlaybackActive &&
				(imageUrl ? (
					<img
						src={imageUrl}
						alt={imageAlt}
						className="absolute inset-0 h-full w-full object-cover"
					/>
				) : (
					<div className="absolute inset-0">
						<AlbumPlaceholder />
					</div>
				))}

			{canPreview && !isPlaybackActive && (
				<button
					type="button"
					onClick={() => {
						warmPreview(0);
						onActivate(playbackId);
					}}
					onPointerEnter={() => warmPreview(50)}
					onPointerDown={() => warmPreview(0)}
					onPointerLeave={coolPreview}
					onFocus={() => warmPreview(50)}
					onBlur={coolPreview}
					className="group absolute inset-0 z-10 flex cursor-pointer items-center justify-center bg-black/10 transition-colors duration-200 hover:bg-black/35 focus-visible:bg-black/35 focus-visible:outline-none motion-safe:active:scale-[0.96]"
					aria-label={playLabel}
				>
					<span
						className="theme-primary flex items-center justify-center rounded-full bg-white/70 shadow-sm [transition:transform_200ms_cubic-bezier(0.165,0.84,0.44,1)] group-hover:scale-110 group-hover:bg-white group-focus-visible:scale-110 group-focus-visible:bg-white group-focus-visible:ring-2 group-focus-visible:ring-[var(--ring)] group-focus-visible:ring-inset"
						style={{ width: playButtonSize, height: playButtonSize }}
					>
						<PlayIcon
							size={playIconSize}
							weight="fill"
							style={{ marginLeft: playIconSize >= 20 ? 2 : 1 }}
						/>
					</span>
				</button>
			)}

			{showIframe && spotifyTrackId && (
				<motion.div
					className="absolute inset-0"
					initial={{ opacity: 0 }}
					animate={{
						opacity: isPlaybackActive ? 1 : 0,
						transition: { duration: 0.25, ease: [0.165, 0.84, 0.44, 1] },
					}}
					style={{ pointerEvents: isPlaybackActive ? "auto" : "none" }}
				>
					<SpotifyEmbedIframe
						spotifyId={spotifyTrackId}
						playWhenReady={isPlaybackActive}
					/>
					{isPlaybackActive && (
						<button
							type="button"
							onClick={onDeactivate}
							aria-label="Close preview"
							className="absolute z-10 cursor-pointer text-white opacity-90 drop-shadow-md transition-opacity duration-200 hover:opacity-100 motion-safe:active:scale-[0.96]"
							style={{ top: closeInset, left: closeInset }}
						>
							<XIcon size={closeIconSize} weight="bold" />
						</button>
					)}
				</motion.div>
			)}

			{/* Inset ring for subtle definition on light-colored covers, matching the
			SongSection / PlaylistReviewItemSection album art treatment. */}
			<div
				className="pointer-events-none absolute inset-0 z-20"
				style={{ boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.16)" }}
			/>
		</div>
	);
}
