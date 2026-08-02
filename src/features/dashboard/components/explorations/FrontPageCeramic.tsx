import { Dateline } from "./Dateline";
import { LikedSongsShelf } from "./LikedSongsShelf";
import { MatchShelf } from "./MatchShelf";
import { PlaylistsShelf } from "./PlaylistsShelf";
import { ProfileLink } from "./ProfileLink";
import type { FrontPageProps } from "./types";
import { Wordmark } from "./Wordmark";

/** Warm-tactile-materiality composition (design-evolution/vision.md): every
 * shelf sits on a grain-textured raised plane, the match lead on the lit
 * tier — the material system doing the sectioning that borders used to.
 * Brand treatment: the sidebar's grain carried into a horizontal band — the
 * wordmark lives ON the material. */
export function FrontPageCeramic({ data, onNavigate }: FrontPageProps) {
	return (
		<div className="mx-auto max-w-5xl px-8 py-10">
			<header className="ceramic-grain surface-raised squircle mb-8 flex items-center justify-between gap-8 rounded-[14px] px-6 py-4">
				<div className="flex items-baseline gap-6">
					<Wordmark size="md" onHome={() => onNavigate("home")} />
					<Dateline />
				</div>
				<ProfileLink
					handle={data.handle}
					planLabel={data.planLabel}
					onOpen={() => onNavigate("settings")}
				/>
			</header>
			<div className="space-y-8">
				<MatchShelf
					count={data.matchCount}
					previews={data.matchPreviews}
					appearance="ceramic"
					onOpen={() => onNavigate("match")}
				/>
				<section className="ceramic-grain surface-raised squircle rounded-[14px] px-6 py-5">
					<LikedSongsShelf
						count={data.likedCount}
						recent={data.recentSongs}
						onBrowse={() => onNavigate("liked-songs")}
						onOpenSong={() => onNavigate("liked-songs")}
					/>
				</section>
				<section className="ceramic-grain surface-raised squircle rounded-[14px] px-6 py-5">
					<PlaylistsShelf
						count={data.playlistCount}
						playlists={data.playlists}
						onBrowse={() => onNavigate("playlists")}
						onOpenPlaylist={() => onNavigate("playlists")}
						onCreate={() => onNavigate("playlists")}
					/>
				</section>
			</div>
		</div>
	);
}
