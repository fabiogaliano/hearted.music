/**
 * PreviewSongRow — a confirmed song in the playlist draft.
 *
 * Visually a solid, hearted-style bleed row (picked treatment). The remove
 * button has a ≥40px touch target via py-3 padding so small clicks still land.
 * A transient "just added" highlight pulse can be triggered by the parent via
 * the `isNew` prop (respects useReducedMotion — collapses to instant opacity
 * when motion is disabled).
 *
 * The cover doubles as an in-row Spotify preview (SpotifyPlaybackCover) when
 * `playback` is supplied and the song has a `spotifyId` — otherwise it falls
 * back to a plain static cover so a broken play affordance never renders.
 */

import { PushPinIcon, XIcon } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "framer-motion";
import { AlbumPlaceholder } from "@/components/ui/AlbumPlaceholder";
import { SpotifyPlaybackCover } from "@/features/playback/SpotifyPlaybackCover";
import type { SingleActivePlayback } from "@/features/playback/useSingleActivePlayback";
import type { SongVM } from "@/lib/domains/playlists/types";
import { cn } from "@/lib/shared/utils/utils";
import { fonts } from "@/lib/theme/fonts";

interface PreviewSongRowProps {
	song: SongVM;
	onRemove: (id: string) => void;
	/** Filled (true) = manual pin, filter-exempt; outline (false) = pinnable. */
	isPinned?: boolean;
	/** Flip the pin: promote to a manual pin or release it (see PreviewList).
	 *  Omitted → the pin toggle is not rendered (e.g. isolated row stories). */
	onTogglePin?: (id: string) => void;
	/** Briefly highlight the row when it first enters the preview. */
	isNew?: boolean;
	/** Shared "one preview at a time" coordinator; see PreviewList/CreatePlaylistScreen.
	 *  Omitted → cover renders as a plain static image (no play affordance). */
	playback?: SingleActivePlayback;
}

export function PreviewSongRow({
	song,
	onRemove,
	isPinned = false,
	onTogglePin,
	isNew = false,
	playback,
}: PreviewSongRowProps) {
	const prefersReducedMotion = useReducedMotion();

	return (
		<motion.div
			initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
			animate={
				prefersReducedMotion
					? { opacity: 1 }
					: isNew
						? {
								opacity: [0, 1, 1],
								y: [4, 0, 0],
								transition: {
									opacity: { duration: 0.25, ease: [0.165, 0.84, 0.44, 1] },
									y: { duration: 0.25, ease: [0.165, 0.84, 0.44, 1] },
								},
							}
						: { opacity: 1, y: 0 }
			}
			exit={
				prefersReducedMotion
					? { opacity: 0 }
					: { opacity: 0, y: 4, transition: { duration: 0.15, ease: "easeIn" } }
			}
			className="theme-border-color -mx-3 flex items-center gap-4 border-b px-3 py-2.5 last:border-b-0"
		>
			{/* Album art — plays an inline Spotify preview when a coordinator and
			spotifyId are both present; otherwise a plain static cover. */}
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
					className="image-outline"
				/>
			) : (
				<div
					className="image-outline h-9 w-9 flex-none overflow-hidden"
					style={{ flexShrink: 0 }}
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

			{/* Title + artist */}
			<div className="min-w-0 flex-1">
				<p
					className="theme-text truncate leading-[1.15]"
					style={{
						fontFamily: fonts.display,
						fontSize: "0.9375rem",
						fontWeight: 300,
					}}
					title={song.name}
				>
					{song.name}
				</p>
				<p
					className="theme-text-muted truncate text-xs"
					style={{ fontFamily: fonts.body }}
				>
					{song.artist}
				</p>
			</div>

			{/* Pin toggle — takes the slot the genre pill used to occupy. Filled = a
			    pick kept in the playlist; outline = a matched song you can pin. */}
			{onTogglePin && (
				<button
					type="button"
					onClick={() => onTogglePin(song.id)}
					aria-pressed={isPinned}
					aria-label={isPinned ? `Unpin ${song.name}` : `Pin ${song.name}`}
					title={isPinned ? "Pinned — kept in your playlist" : "Pin this song"}
					className={cn(
						"flex-none cursor-pointer rounded-full p-2",
						"transition-opacity duration-150 active:scale-[0.96]",
						"focus-visible:outline-2 focus-visible:outline-offset-2",
						"[outline-color:var(--t-primary)]",
						isPinned
							? "opacity-100 hover:opacity-80"
							: "theme-text-muted opacity-50 hover:opacity-90",
					)}
					style={{
						minWidth: 40,
						minHeight: 40,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						color: isPinned ? "var(--t-primary)" : undefined,
					}}
				>
					<PushPinIcon
						size={15}
						weight={isPinned ? "fill" : "regular"}
						aria-hidden
					/>
				</button>
			)}

			{/* Remove button — ≥40px hit area via explicit min dimensions */}
			<button
				type="button"
				onClick={() => onRemove(song.id)}
				aria-label={`Remove ${song.name}`}
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
				<XIcon size={14} weight="bold" aria-hidden />
			</button>
		</motion.div>
	);
}
