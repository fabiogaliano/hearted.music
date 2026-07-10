/**
 * Prototype — Direction A: match-reason as a muted inline hint under the
 * artist line ("Indie pop · 2014"). Loose fork of PreviewSongRow: same bleed
 * row idiom and remove button, minus the enter/exit motion (not the point of
 * this exploration) plus a third text line for the reason.
 */

import { XIcon } from "@phosphor-icons/react";
import { AlbumPlaceholder } from "@/components/ui/AlbumPlaceholder";
import { cn } from "@/lib/shared/utils/utils";
import { fonts } from "@/lib/theme/fonts";
import type { SongWithReason } from "./types";

interface PreviewRowInlineHintProps {
	song: SongWithReason;
	onRemove: (id: string) => void;
}

export function PreviewRowInlineHint({
	song,
	onRemove,
}: PreviewRowInlineHintProps) {
	return (
		<div className="theme-border-color -mx-3 flex items-center gap-4 border-b px-3 py-2.5 last:border-b-0">
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
				<p
					className="theme-text-muted truncate text-[11px]"
					style={{ fontFamily: fonts.body, opacity: 0.55 }}
				>
					{song.matchReason}
				</p>
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
