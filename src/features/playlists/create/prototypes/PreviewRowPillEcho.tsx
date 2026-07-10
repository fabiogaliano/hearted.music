/**
 * Prototype — Direction B: genre-pill echo. Instead of new copy, the row's
 * existing genre pill (already shown in prod PreviewSongRow) is highlighted
 * when it's the pill that matched the active config — the "why" lives in
 * a chip the user placed themselves, via a hover/focus tooltip for the exact
 * wording ("Matched your Indie pick").
 */

import { XIcon } from "@phosphor-icons/react";
import { AlbumPlaceholder } from "@/components/ui/AlbumPlaceholder";
import { cn } from "@/lib/shared/utils/utils";
import { fonts } from "@/lib/theme/fonts";
import { MatchedGenrePill } from "./MatchedGenrePill";
import type { SongWithReason } from "./types";

interface PreviewRowPillEchoProps {
	song: SongWithReason;
	onRemove: (id: string) => void;
}

export function PreviewRowPillEcho({
	song,
	onRemove,
}: PreviewRowPillEchoProps) {
	const primaryGenre = song.genres[0];
	const isMatched = !!song.matchedGenre && song.matchedGenre === primaryGenre;

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
			</div>

			{primaryGenre && (
				<span
					title={isMatched ? song.matchReason : undefined}
					className={isMatched ? "cursor-help" : undefined}
				>
					<MatchedGenrePill genre={primaryGenre} isMatched={isMatched} />
				</span>
			)}

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
