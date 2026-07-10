/**
 * PartialState — shown when the playlist row exists locally but the commit
 * couldn't finish adding the songs: either the config persist threw, or the
 * bulk track-add failed. In both cases no tracks landed on the Spotify
 * playlist (the add is a single atomic command), so the copy says exactly
 * that rather than implying a partial success that never happens.
 *
 * No "Retry" is offered here yet. A safe retry is possible in principle
 * (re-run config + track-add against the existing playlist, like UnsyncedState
 * does for the unsynced case), but re-adding tracks is not idempotent on
 * Spotify's side, so it needs the duplicate-tracks handling designed in the
 * partial-retry proposal before it can ship. Until then we surface the link
 * and an honest message so the user can finish in Spotify.
 */

import { ArrowSquareOutIcon, WarningIcon } from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/Button";
import { fonts } from "@/lib/theme/fonts";

interface PartialStateProps {
	spotifyId: string;
	failedTrackCount: number;
}

export function PartialState({
	spotifyId,
	failedTrackCount,
}: PartialStateProps) {
	const navigate = useNavigate();
	const spotifyUrl = `https://open.spotify.com/playlist/${spotifyId}`;
	const songNoun = failedTrackCount === 1 ? "song" : "songs";

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
							Playlist created — songs couldn't be added
						</p>
						<p
							className="theme-text-muted text-xs"
							style={{ fontFamily: fonts.body }}
						>
							The playlist was created on Spotify, but your {failedTrackCount}{" "}
							{songNoun} couldn't be added to it. Open it in Spotify to add{" "}
							{failedTrackCount === 1 ? "it" : "them"} manually.
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
