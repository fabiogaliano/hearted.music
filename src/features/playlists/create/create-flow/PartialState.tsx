/**
 * PartialState — shown when the playlist was created but not all tracks
 * were added (or config/tracks couldn't be persisted at all).
 *
 * Two distinct messages:
 *  - failedTrackCount === totalSongCount → config/track persist failed entirely
 *    (playlist exists but has nothing in it).
 *  - otherwise → some tracks couldn't be added; the rest are there.
 *
 * No "Retry" is offered because re-submitting would call createPlaylistFromDraft
 * again and create a second duplicate Spotify playlist. The correct resolution
 * is to open the existing playlist on Spotify, or navigate away and start a
 * new draft. A track-only retry would require a separate add-tracks-only path
 * that doesn't exist; until it does, we surface the link and a clear message.
 */

import { ArrowSquareOutIcon, WarningIcon } from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/Button";
import { fonts } from "@/lib/theme/fonts";

interface PartialStateProps {
	spotifyId: string;
	failedTrackCount: number;
	totalSongCount: number;
}

export function PartialState({
	spotifyId,
	failedTrackCount,
	totalSongCount,
}: PartialStateProps) {
	const navigate = useNavigate();
	const spotifyUrl = `https://open.spotify.com/playlist/${spotifyId}`;
	const isCompleteFailure = failedTrackCount >= totalSongCount;

	return (
		<div
			className="px-6 py-6"
			role="status"
			aria-live="polite"
			aria-atomic="true"
		>
			<div className="flex items-start gap-4">
				<WarningIcon
					size={18}
					weight="regular"
					className="theme-text-muted mt-0.5 shrink-0"
					aria-hidden
				/>

				<div className="flex flex-col gap-3">
					<div>
						<p
							className="theme-text-muted mb-1 text-[11px] tracking-widest uppercase"
							style={{ fontFamily: fonts.body }}
						>
							{isCompleteFailure
								? "Playlist created — tracks couldn't be added"
								: "Playlist created — partially"}
						</p>
						<p
							className="theme-text-muted text-xs"
							style={{ fontFamily: fonts.body }}
						>
							{isCompleteFailure
								? "The playlist was created on Spotify but none of the tracks could be saved. Open it in Spotify to add tracks manually."
								: `${failedTrackCount} ${failedTrackCount === 1 ? "track" : "tracks"} couldn't be added. The rest are in your Spotify playlist.`}
						</p>
					</div>

					<div className="flex items-center gap-3">
						<a
							href={spotifyUrl}
							target="_blank"
							rel="noopener noreferrer"
							className="hover-border-brighten inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs tracking-widest uppercase active:scale-[0.98]"
							style={{ fontFamily: fonts.body }}
						>
							Open in Spotify
							<ArrowSquareOutIcon
								size={11}
								weight="regular"
								aria-hidden
								style={{ opacity: 0.45 }}
							/>
						</a>

						<Button
							variant="ghost"
							size="sm"
							onClick={() => void navigate({ to: "/playlists" })}
						>
							Done
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}
