/**
 * UnsyncedState — shown when the playlist was created on Spotify but the local
 * setup couldn't finish: the DB acknowledge write failed even after retries, so
 * no local row, config, or tracks were persisted yet.
 *
 * Unlike PartialState, a Retry IS offered here and is safe: it resumes from the
 * acknowledge/config steps against the EXISTING Spotify playlist (via
 * resumePlaylistCreateFromDraft), so it can never create a duplicate. The retry
 * re-drives the draft's config + track adds so the original draft settings are
 * preserved rather than silently lost.
 */

import { ArrowSquareOutIcon, WarningIcon } from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/Button";
import { fonts } from "@/lib/theme/fonts";

interface UnsyncedStateProps {
	spotifyId: string;
	onRetry: () => void;
	isRetrying: boolean;
}

export function UnsyncedState({
	spotifyId,
	onRetry,
	isRetrying,
}: UnsyncedStateProps) {
	const navigate = useNavigate();
	const spotifyUrl = `https://open.spotify.com/playlist/${spotifyId}`;

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
							Playlist created — couldn't finish setup
						</p>
						<p
							className="theme-text-muted text-xs"
							style={{ fontFamily: fonts.body }}
						>
							The playlist was created on Spotify, but we couldn't finish
							setting it up here. Retry to add your songs and settings to the
							same playlist — this won't create a duplicate.
						</p>
					</div>

					<div className="flex items-center gap-3">
						<Button
							variant="primary"
							size="sm"
							disabled={isRetrying}
							aria-busy={isRetrying}
							onClick={onRetry}
						>
							{isRetrying ? "Retrying…" : "Retry"}
						</Button>

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
