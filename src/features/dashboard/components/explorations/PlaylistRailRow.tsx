import { fonts } from "@/lib/theme/fonts";
import type { PlaylistVM } from "./types";

interface PlaylistRailRowProps {
	playlist: PlaylistVM;
	onOpen: () => void;
}

/** Editorial rail row: bordered, typography-led — the older bleed-row idiom
 * for the magazine composition, deliberately not a card. */
export function PlaylistRailRow({ playlist, onOpen }: PlaylistRailRowProps) {
	return (
		<button
			type="button"
			onClick={onOpen}
			className="theme-hover-surface theme-border-color focus-edge -mx-3 flex w-[calc(100%+1.5rem)] items-center gap-4 border-b px-3 py-2.5 text-left transition-[background-color] duration-150 ease-out"
		>
			<img
				src={playlist.coverUrl}
				alt=""
				loading="lazy"
				className="image-outline size-10 shrink-0 object-cover"
			/>
			<span
				className="theme-text min-w-0 flex-1 truncate text-sm font-light"
				style={{ fontFamily: fonts.body }}
				title={playlist.name}
			>
				{playlist.name}
			</span>
			<span
				className="theme-text-muted shrink-0 text-xs tabular-nums"
				style={{ fontFamily: fonts.body }}
			>
				{playlist.trackCount}
			</span>
		</button>
	);
}
