import { CoverTile, NewPlaylistTile } from "./CoverTile";
import { ShelfHeader } from "./ShelfHeader";
import type { PlaylistVM } from "./types";

interface PlaylistsShelfProps {
	count: number;
	playlists: PlaylistVM[];
	onBrowse: () => void;
	/** Prod: cover → /playlists/$playlistRef; the harness routes to the spoke. */
	onOpenPlaylist: (playlist: PlaylistVM) => void;
	onCreate: () => void;
}

/** Cover strip as navigation — the covers carry the scent the sidebar's plain
 * "Playlists" label never had. The create tile keeps creation one interaction
 * from home, matching the dashboard CTA it replaces. */
export function PlaylistsShelf({
	count,
	playlists,
	onBrowse,
	onOpenPlaylist,
	onCreate,
}: PlaylistsShelfProps) {
	return (
		<section>
			<ShelfHeader label="Playlists" count={count} onOpen={onBrowse} />
			<div className="flex gap-4 overflow-x-auto pb-1">
				{playlists.map((playlist) => (
					<CoverTile
						key={playlist.id}
						playlist={playlist}
						onOpen={() => onOpenPlaylist(playlist)}
					/>
				))}
				<NewPlaylistTile onCreate={onCreate} />
			</div>
		</section>
	);
}
