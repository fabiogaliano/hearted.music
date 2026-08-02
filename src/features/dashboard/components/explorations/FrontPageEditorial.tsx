import { ArrowRightIcon } from "@phosphor-icons/react";
import { fonts } from "@/lib/theme/fonts";
import { FanSpreadAlbumArt } from "../FanSpreadAlbumArt";
import { Dateline } from "./Dateline";
import { LikedSongsShelf } from "./LikedSongsShelf";
import { PlaylistRailRow } from "./PlaylistRailRow";
import { ProfileLink } from "./ProfileLink";
import { ShelfHeader } from "./ShelfHeader";
import type { FrontPageProps } from "./types";
import { Wordmark } from "./Wordmark";

/** Two-column magazine composition (the matching page's stage idiom): the
 * match queue as lead story on the left — pure typography, no card — with the
 * library as a right-hand rail of bordered rows. Brand treatment: a broadsheet
 * nameplate — wordmark, dateline, and profile in one double-rule band. */
export function FrontPageEditorial({ data, onNavigate }: FrontPageProps) {
	return (
		<div className="mx-auto max-w-5xl px-8 py-10">
			<header className="theme-border-color mb-10 flex items-center justify-between gap-8 border-y py-3">
				<Wordmark size="md" onHome={() => onNavigate("home")} />
				<Dateline />
				<ProfileLink
					handle={data.handle}
					planLabel={data.planLabel}
					onOpen={() => onNavigate("settings")}
				/>
			</header>
			<div className="grid gap-10 lg:grid-cols-[1.1fr_1fr]">
				<section>
					{data.matchCount === 0 ? (
						<p
							className="theme-text-muted text-sm"
							style={{ fontFamily: fonts.body }}
						>
							Your songs have found their{" "}
							<em style={{ fontFamily: fonts.display }}>home</em>.
						</p>
					) : (
						<>
							<p
								className="theme-text-muted mb-4 text-xs tracking-widest uppercase"
								style={{ fontFamily: fonts.body }}
							>
								Ready to match
							</p>
							<h3
								className="theme-text text-5xl font-extralight leading-[1.05] tracking-tight text-balance"
								style={{ fontFamily: fonts.display }}
							>
								{data.matchCount} {data.matchCount === 1 ? "song" : "songs"}{" "}
								looking for {data.matchCount === 1 ? "a home" : "homes"}
							</h3>
							<div className="mt-14 mb-10">
								<FanSpreadAlbumArt images={data.matchPreviews} />
							</div>
							<button
								type="button"
								onClick={() => onNavigate("match")}
								className="focus-edge-offset theme-text group inline-flex items-center gap-1.5 text-sm"
								style={{ fontFamily: fonts.body }}
							>
								Start matching
								<ArrowRightIcon
									size={14}
									weight="regular"
									className="transition-transform duration-200 ease-out motion-safe:group-hover:translate-x-1"
								/>
							</button>
						</>
					)}
				</section>
				<div className="space-y-10">
					<LikedSongsShelf
						count={data.likedCount}
						recent={data.recentSongs}
						onBrowse={() => onNavigate("liked-songs")}
						onOpenSong={() => onNavigate("liked-songs")}
					/>
					<section>
						<ShelfHeader
							label="Playlists"
							count={data.playlistCount}
							onOpen={() => onNavigate("playlists")}
						/>
						<div>
							{data.playlists.map((playlist) => (
								<PlaylistRailRow
									key={playlist.id}
									playlist={playlist}
									onOpen={() => onNavigate("playlists")}
								/>
							))}
						</div>
						<button
							type="button"
							onClick={() => onNavigate("playlists")}
							className="focus-edge-offset theme-text-muted mt-4 text-xs tracking-widest uppercase transition-colors duration-150 ease-out hover:text-(--t-text) motion-reduce:transition-none"
							style={{ fontFamily: fonts.body }}
						>
							New playlist +
						</button>
					</section>
				</div>
			</div>
		</div>
	);
}
