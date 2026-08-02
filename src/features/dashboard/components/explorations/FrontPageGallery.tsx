import { CoverTile, NewPlaylistTile } from "./CoverTile";
import { Dateline } from "./Dateline";
import { LikedSongsShelf } from "./LikedSongsShelf";
import { MatchShelf } from "./MatchShelf";
import { ProfileLink } from "./ProfileLink";
import { ShelfHeader } from "./ShelfHeader";
import type { FrontPageProps } from "./types";
import { Wordmark } from "./Wordmark";

/** Art-dominant composition: the match lead on the lit tier, then the
 * playlists as a full cover wall — the gallery hangs the art, the liked list
 * stays quiet below it. Brand treatment: an exhibition plaque — small
 * wordmark, one hairline rule reaching across to the profile. */
export function FrontPageGallery({ data, onNavigate }: FrontPageProps) {
	return (
		<div className="mx-auto max-w-5xl px-8 py-10">
			<header className="mb-12 flex items-center gap-6">
				<Wordmark size="md" onHome={() => onNavigate("home")} />
				<span aria-hidden="true" className="theme-border-bg h-px flex-1" />
				<Dateline />
				<ProfileLink
					handle={data.handle}
					planLabel={data.planLabel}
					onOpen={() => onNavigate("settings")}
				/>
			</header>
			<div className="space-y-12">
				<MatchShelf
					count={data.matchCount}
					previews={data.matchPreviews}
					appearance="lit"
					onOpen={() => onNavigate("match")}
				/>
				<section>
					<ShelfHeader
						label="Playlists"
						count={data.playlistCount}
						onOpen={() => onNavigate("playlists")}
					/>
					<div className="grid grid-cols-6 gap-4">
						{data.playlists.map((playlist) => (
							<CoverTile
								key={playlist.id}
								playlist={playlist}
								fluid
								onOpen={() => onNavigate("playlists")}
							/>
						))}
						<NewPlaylistTile fluid onCreate={() => onNavigate("playlists")} />
					</div>
				</section>
				<LikedSongsShelf
					count={data.likedCount}
					recent={data.recentSongs}
					onBrowse={() => onNavigate("liked-songs")}
					onOpenSong={() => onNavigate("liked-songs")}
				/>
			</div>
		</div>
	);
}
