/**
 * Prototype — Direction C: hover/focus-revealed detail. The reason stays
 * hidden at rest (keeps the row as quiet as prod's PreviewSongRow) and
 * crossfades in under the artist line on row hover/focus-within, so it costs
 * no vertical space until the user is actually inspecting a song. CSS-only
 * (no Framer) since this is a simple opacity/height reveal driven by
 * `:hover`/`:focus-within`, gated behind `motion-reduce` for the height
 * animation.
 */

import { XIcon } from "@phosphor-icons/react";
import { AlbumPlaceholder } from "@/components/ui/AlbumPlaceholder";
import { cn } from "@/lib/shared/utils/utils";
import { fonts } from "@/lib/theme/fonts";
import type { SongWithReason } from "./types";

interface PreviewRowHoverDetailProps {
	song: SongWithReason;
	onRemove: (id: string) => void;
}

export function PreviewRowHoverDetail({
	song,
	onRemove,
}: PreviewRowHoverDetailProps) {
	return (
		<div className="theme-border-color group -mx-3 flex items-center gap-4 border-b px-3 py-2.5 last:border-b-0">
			<div className="image-outline h-9 w-9 flex-none overflow-hidden">
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
				{/* Hidden at rest; reveals on row hover/focus so it costs no space
				    until the user is inspecting this song. grid-rows trick animates
				    height without a fixed pixel value. */}
				<div
					className={cn(
						"grid transition-[grid-template-rows,opacity] duration-150 ease-out",
						"grid-rows-[0fr] opacity-0",
						"group-hover:grid-rows-[1fr] group-hover:opacity-100",
						"group-focus-within:grid-rows-[1fr] group-focus-within:opacity-100",
						"motion-reduce:transition-none",
					)}
				>
					<p
						className="theme-text-muted truncate text-[11px] leading-[1.6]"
						style={{ fontFamily: fonts.body, opacity: 0.6 }}
					>
						{song.matchReason}
					</p>
				</div>
			</div>

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
		</div>
	);
}
