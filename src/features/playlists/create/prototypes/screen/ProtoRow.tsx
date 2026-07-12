/**
 * Prototype shared atom — the song row held CONSTANT across every
 * whole-screen direction (prod-faithful anatomy, loose fork of
 * PreviewSongRow/SuggestionRow minus motion and playback). Only the
 * composition around it varies. `compact` drops the genre label and
 * tightens padding for narrow shelves/panes.
 */

import { PlusIcon, XIcon } from "@phosphor-icons/react";
import { AlbumPlaceholder } from "@/components/ui/AlbumPlaceholder";
import type { SongVM } from "@/lib/domains/playlists/types";
import { cn } from "@/lib/shared/utils/utils";
import { fonts } from "@/lib/theme/fonts";

interface ProtoRowProps {
	song: SongVM;
	action: "remove" | "add";
	onAction: (id: string) => void;
	compact?: boolean;
}

export function ProtoRow({
	song,
	action,
	onAction,
	compact = false,
}: ProtoRowProps) {
	const ActionIcon = action === "remove" ? XIcon : PlusIcon;
	return (
		<div
			className={cn(
				"theme-border-color -mx-3 flex items-center border-b px-3 last:border-b-0",
				compact ? "gap-3 py-2" : "gap-4 py-2.5",
			)}
		>
			<div
				className={cn(
					"image-outline flex-none overflow-hidden",
					compact ? "h-8 w-8" : "h-9 w-9",
				)}
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

			<div className="min-w-0 flex-1">
				<p
					className="theme-text truncate leading-[1.15]"
					style={{
						fontFamily: fonts.display,
						fontSize: compact ? "0.875rem" : "0.9375rem",
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

			{!compact && song.genres.length > 0 && (
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

			<button
				type="button"
				onClick={() => onAction(song.id)}
				aria-label={
					action === "remove" ? `Remove ${song.name}` : `Add ${song.name}`
				}
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
				<ActionIcon size={14} weight="bold" aria-hidden />
			</button>
		</div>
	);
}
