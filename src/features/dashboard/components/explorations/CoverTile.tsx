import { PlusIcon } from "@phosphor-icons/react";
import { fonts } from "@/lib/theme/fonts";
import type { PlaylistVM } from "./types";

/** fluid = fill the grid cell (gallery wall); fixed = the shelf strip's w-28. */
interface CoverTileProps {
	playlist: PlaylistVM;
	fluid?: boolean;
	onOpen: () => void;
}

export function CoverTile({ playlist, fluid = false, onOpen }: CoverTileProps) {
	return (
		<button
			type="button"
			onClick={onOpen}
			className={`focus-edge-offset group text-left ${fluid ? "w-full" : "w-28 shrink-0"}`}
		>
			<img
				src={playlist.coverUrl}
				alt=""
				loading="lazy"
				className={`image-outline object-cover ${fluid ? "aspect-square w-full" : "size-28"}`}
			/>
			<span
				className="theme-text-muted mt-2 block truncate text-xs transition-colors duration-150 ease-out group-hover:text-(--t-text) motion-reduce:transition-none"
				style={{ fontFamily: fonts.body }}
				title={playlist.name}
			>
				{playlist.name}
			</span>
			<span
				className="theme-text-muted block text-xs tabular-nums opacity-70"
				style={{ fontFamily: fonts.body }}
			>
				{playlist.trackCount} songs
			</span>
		</button>
	);
}

interface NewPlaylistTileProps {
	fluid?: boolean;
	onCreate: () => void;
}

export function NewPlaylistTile({
	fluid = false,
	onCreate,
}: NewPlaylistTileProps) {
	return (
		<button
			type="button"
			onClick={onCreate}
			className={`focus-edge-offset group text-left ${fluid ? "w-full" : "w-28 shrink-0"}`}
		>
			<span
				className={`surface-raised surface-raised-hover squircle flex items-center justify-center rounded-[10px] ${
					fluid ? "aspect-square w-full" : "size-28"
				}`}
			>
				<PlusIcon size={20} weight="light" className="theme-text-muted" />
			</span>
			<span
				className="theme-text-muted mt-2 block text-xs transition-colors duration-150 ease-out group-hover:text-(--t-text) motion-reduce:transition-none"
				style={{ fontFamily: fonts.body }}
			>
				New playlist
			</span>
		</button>
	);
}
