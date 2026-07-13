/**
 * SuggestionRow — one system-suggested song in the tray.
 *
 * Visually distinct from PreviewSongRow (picked rows): uses a slightly dimmed,
 * dashed-left-border treatment to communicate "system proposed, not yet yours."
 * The flat bordered materiality is preserved — no gradients, no elevation.
 *
 * The add (+) button is a real focusable button with aria-label and a ≥40px
 * hit area. Keyboard: Enter/Space activate via native button behaviour. The
 * dismiss (×) button is visual/interaction parity with PreviewSongRow's remove
 * button (same size, hit target, icon) but stays secondary to add: lower
 * opacity at rest, add keeps the primary (less muted) treatment.
 *
 * The cover doubles as an in-row Spotify preview (SpotifyPlaybackCover) when
 * `playback` is supplied and the song has a `spotifyId` — otherwise it falls
 * back to a plain static cover so a broken play affordance never renders.
 */

import { PlusIcon, XIcon } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "framer-motion";
import { AlbumPlaceholder } from "@/components/ui/AlbumPlaceholder";
import { SpotifyPlaybackCover } from "@/features/playback/SpotifyPlaybackCover";
import type { SingleActivePlayback } from "@/features/playback/useSingleActivePlayback";
import type { SongVM } from "@/lib/domains/playlists/types";
import { cn } from "@/lib/shared/utils/utils";
import { fonts } from "@/lib/theme/fonts";

interface SuggestionRowProps {
	song: SongVM;
	onAdd: (id: string) => void;
	onDismiss: (id: string) => void;
	/** Shared "one preview at a time" coordinator; see SuggestionsTray/CreatePlaylistScreen.
	 *  Omitted → cover renders as a plain static image (no play affordance). */
	playback?: SingleActivePlayback;
}

export function SuggestionRow({
	song,
	onAdd,
	onDismiss,
	playback,
}: SuggestionRowProps) {
	const prefersReducedMotion = useReducedMotion();

	return (
		<motion.div
			initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
			animate={{ opacity: 1, y: 0 }}
			exit={
				prefersReducedMotion
					? { opacity: 0 }
					: { opacity: 0, y: 4, transition: { duration: 0.15, ease: "easeIn" } }
			}
			className={cn(
				// Bleed row idiom — same negative margin pattern as other rows
				"-mx-3 flex items-center gap-4 border-b px-3 py-2.5 last:border-b-0",
				// Distinct suggestion treatment: muted border, slightly faded text
				"theme-border-color",
			)}
			// Left accent: dashed left border signals "suggested, not pinned"
			style={{ borderLeft: "2px dashed var(--t-border)" }}
		>
			{/* Album art — dimmed vs. preview rows to reinforce secondary status.
			The dimming only applies at rest (not while actively playing), so an
			active preview here reads at full strength like a picked row's cover. */}
			{playback && song.spotifyId ? (
				<SpotifyPlaybackCover
					playbackId={song.id}
					spotifyTrackId={song.spotifyId}
					imageUrl={song.imageUrl}
					imageAlt={song.name}
					playLabel={`Play preview for ${song.name}`}
					size={36}
					isPlaybackActive={playback.activePlaybackId === song.id}
					onActivate={playback.activatePlayback}
					onDeactivate={playback.deactivatePlayback}
					playButtonSize={24}
					playIconSize={11}
					closeIconSize={11}
					closeInset="0.125rem"
					className={cn(
						"image-outline",
						playback.activePlaybackId !== song.id && "opacity-75",
					)}
				/>
			) : (
				<div
					className="image-outline h-9 w-9 flex-none overflow-hidden"
					style={{ flexShrink: 0, opacity: 0.75 }}
				>
					{song.imageUrl ? (
						<img
							src={song.imageUrl}
							alt=""
							aria-hidden="true"
							className="h-full w-full object-cover"
						/>
					) : (
						<AlbumPlaceholder />
					)}
				</div>
			)}

			{/* Title + artist — muted tone vs. picked rows */}
			<div className="min-w-0 flex-1">
				<p
					className="theme-text-muted truncate leading-[1.15]"
					style={{
						fontFamily: fonts.display,
						fontSize: "0.9375rem",
						fontWeight: 300,
						// Slightly less prominent than a picked row
						opacity: 0.85,
					}}
					title={song.name}
				>
					{song.name}
				</p>
				<p
					className="theme-text-muted truncate text-xs"
					style={{ fontFamily: fonts.body, opacity: 0.7 }}
				>
					{song.artist}
				</p>
			</div>

			{/* Dismiss button — secondary to add: lower resting opacity, same hit
			    target/size as PreviewSongRow's remove button. Placed before add so
			    add stays the visually terminal, primary action in reading order. */}
			<button
				type="button"
				onClick={() => onDismiss(song.id)}
				aria-label={`Dismiss ${song.name}`}
				className={cn(
					"theme-text-muted flex-none cursor-pointer rounded-full p-2",
					"transition-opacity duration-150 hover:opacity-70 active:scale-[0.96]",
					"focus-visible:outline-2 focus-visible:outline-offset-2",
					"[outline-color:var(--t-primary)]",
				)}
				style={{
					minWidth: 40,
					minHeight: 40,
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					opacity: 0.5,
				}}
			>
				<XIcon size={14} weight="regular" aria-hidden />
			</button>

			{/* Add button — ≥40px hit area, the primary affordance */}
			<button
				type="button"
				onClick={() => onAdd(song.id)}
				aria-label={`Add ${song.name} to playlist`}
				className={cn(
					"theme-text-muted flex-none cursor-pointer rounded-full p-2",
					"transition-opacity duration-150 hover:opacity-70 active:scale-[0.96]",
					"focus-visible:outline-2 focus-visible:outline-offset-2",
					"[outline-color:var(--t-primary)]",
				)}
				style={{
					minWidth: 40,
					minHeight: 40,
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
				}}
			>
				<PlusIcon size={14} weight="regular" aria-hidden />
			</button>
		</motion.div>
	);
}
