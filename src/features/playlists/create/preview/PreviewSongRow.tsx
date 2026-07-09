/**
 * PreviewSongRow — a confirmed song in the playlist draft.
 *
 * Visually a solid, hearted-style bleed row (picked treatment). The remove
 * button has a ≥40px touch target via py-3 padding so small clicks still land.
 * A transient "just added" highlight pulse can be triggered by the parent via
 * the `isNew` prop (respects useReducedMotion — collapses to instant opacity
 * when motion is disabled).
 */

import { XIcon } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "framer-motion";
import { AlbumPlaceholder } from "@/components/ui/AlbumPlaceholder";
import type { SongVM } from "@/lib/domains/playlists/types";
import { cn } from "@/lib/shared/utils/utils";
import { fonts } from "@/lib/theme/fonts";

interface PreviewSongRowProps {
	song: SongVM;
	onRemove: (id: string) => void;
	/** Briefly highlight the row when it first enters the preview. */
	isNew?: boolean;
}

export function PreviewSongRow({
	song,
	onRemove,
	isNew = false,
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
			{/* Album art */}
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

			{/* Genre pill — optional; rendered when present and space permits */}
			{song.genres.length > 0 && (
				<span
					className="theme-text-muted hidden flex-none text-[10px] lg:block"
					style={{
						fontFamily: fonts.body,
						letterSpacing: "0.07em",
						opacity: 0.6,
					}}
				>
					{song.genres[0]}
				</span>
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
