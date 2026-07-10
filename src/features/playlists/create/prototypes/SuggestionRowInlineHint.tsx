/**
 * Prototype — Direction A on the suggestion row: same muted inline hint under
 * the artist line, on the dashed-border "suggested" treatment.
 */

import { PlusIcon } from "@phosphor-icons/react";
import { AlbumPlaceholder } from "@/components/ui/AlbumPlaceholder";
import { cn } from "@/lib/shared/utils/utils";
import { fonts } from "@/lib/theme/fonts";
import type { SongWithReason } from "./types";

interface SuggestionRowInlineHintProps {
	song: SongWithReason;
	onAdd: (id: string) => void;
}

export function SuggestionRowInlineHint({
	song,
	onAdd,
}: SuggestionRowInlineHintProps) {
	return (
		<div
			className={cn(
				"-mx-3 flex items-center gap-4 border-b px-3 py-2.5 last:border-b-0",
				"theme-border-color",
			)}
			style={{ borderLeft: "2px dashed var(--t-border)" }}
		>
			<div
				className="image-outline h-9 w-9 flex-none overflow-hidden"
				style={{ opacity: 0.75 }}
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
					className="theme-text-muted truncate leading-[1.15]"
					style={{
						fontFamily: fonts.display,
						fontSize: "0.9375rem",
						fontWeight: 300,
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
				<p
					className="theme-text-muted truncate text-[11px]"
					style={{ fontFamily: fonts.body, opacity: 0.5 }}
				>
					{song.matchReason}
				</p>
			</div>

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
		</div>
	);
}
