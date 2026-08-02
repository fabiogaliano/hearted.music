import { fonts } from "@/lib/theme/fonts";
import { ShelfHeader } from "./ShelfHeader";
import type { SongVM } from "./types";

interface LikedSongsShelfProps {
	count: number;
	recent: SongVM[];
	onBrowse: () => void;
	/** In prod each row deep-links to /liked-songs?song=slug; the harness routes
	 * all rows to the spoke. */
	onOpenSong: (song: SongVM) => void;
}

/** Library presence on the hub: header = the neutral browse entry, recent rows
 * = the scent (this shelf absorbs the activity feed's "liked" events). */
export function LikedSongsShelf({
	count,
	recent,
	onBrowse,
	onOpenSong,
}: LikedSongsShelfProps) {
	return (
		<section>
			<ShelfHeader label="Liked Songs" count={count} onOpen={onBrowse} />
			<ul>
				{recent.map((song) => (
					<li key={song.id}>
						<button
							type="button"
							onClick={() => onOpenSong(song)}
							className="surface-raised-hover squircle focus-edge -mx-4 flex w-[calc(100%+2rem)] items-center gap-4 rounded-[10px] px-4 py-3 text-left transition-[background-color] duration-150 ease-out"
						>
							<img
								src={song.coverUrl}
								alt=""
								loading="lazy"
								className="image-outline size-12 shrink-0 object-cover"
							/>
							<span className="min-w-0 flex-1">
								<span
									className="theme-text block truncate text-base font-light leading-[1.1]"
									style={{ fontFamily: fonts.display }}
								>
									{song.title}
								</span>
								<span
									className="theme-text-muted mt-0.5 block truncate text-sm leading-tight"
									style={{ fontFamily: fonts.body }}
								>
									{song.artist}
								</span>
							</span>
							<span
								className="theme-text-muted shrink-0 text-xs tabular-nums"
								style={{ fontFamily: fonts.body }}
							>
								{song.likedAgo}
							</span>
						</button>
					</li>
				))}
			</ul>
		</section>
	);
}
