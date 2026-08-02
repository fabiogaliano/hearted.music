import { Dateline } from "./Dateline";
import { LikedSongsShelf } from "./LikedSongsShelf";
import { MatchShelf } from "./MatchShelf";
import { PlaylistsShelf } from "./PlaylistsShelf";
import { ProfileLink } from "./ProfileLink";
import type { FrontPageProps } from "./types";
import { Wordmark } from "./Wordmark";

/** Baseline stack: the dashboard as editorial front page whose sections ARE
 * the destinations. Brand treatment: the sidebar's head, rotated into the
 * page — big "hearted." top-left, profile strip top-right. */
export function FrontPage({ data, onNavigate }: FrontPageProps) {
	return (
		<div className="mx-auto max-w-5xl px-8 py-10">
			<header className="mb-10 flex items-start justify-between gap-8">
				<div>
					<Wordmark size="lg" onHome={() => onNavigate("home")} />
					<Dateline className="mt-3" />
				</div>
				<ProfileLink
					handle={data.handle}
					planLabel={data.planLabel}
					onOpen={() => onNavigate("settings")}
				/>
			</header>
			<div className="space-y-10">
				<MatchShelf
					count={data.matchCount}
					previews={data.matchPreviews}
					onOpen={() => onNavigate("match")}
				/>
				<LikedSongsShelf
					count={data.likedCount}
					recent={data.recentSongs}
					onBrowse={() => onNavigate("liked-songs")}
					onOpenSong={() => onNavigate("liked-songs")}
				/>
				<PlaylistsShelf
					count={data.playlistCount}
					playlists={data.playlists}
					onBrowse={() => onNavigate("playlists")}
					onOpenPlaylist={() => onNavigate("playlists")}
					onCreate={() => onNavigate("playlists")}
				/>
			</div>
		</div>
	);
}
