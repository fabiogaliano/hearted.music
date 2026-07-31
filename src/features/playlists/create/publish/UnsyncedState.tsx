import { WarningIcon } from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/Button";
import { fonts } from "@/lib/theme/fonts";
import { SpotifyPlaylistLink } from "./SpotifyPlaylistLink";

interface UnsyncedStateProps {
	spotifyId: string;
	onRetry: () => void;
	isRetrying: boolean;
	retryBlocked: boolean;
	/** When retryBlocked, the extension's display name explains why. */
	mismatchDisplayName?: string | null;
}

export function UnsyncedState({
	spotifyId,
	onRetry,
	isRetrying,
	retryBlocked,
	mismatchDisplayName,
}: UnsyncedStateProps) {
	const navigate = useNavigate();
	return (
		<div
			className="px-5 py-5"
			style={
				retryBlocked ? { borderLeft: "2px solid var(--t-primary)" } : undefined
			}
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
							Created, not synced back
						</p>
						<p
							className="theme-text-muted text-xs"
							style={{ fontFamily: fonts.body }}
						>
							{retryBlocked && mismatchDisplayName
								? `Retry is paused. Spotify is signed in as ${mismatchDisplayName}, not the account this library belongs to.`
								: "It's on Spotify, but hearted could not record it. Retrying is safe."}
						</p>
					</div>

					<div className="flex items-center gap-3">
						<Button
							variant="primary"
							size="sm"
							disabled={isRetrying || retryBlocked}
							aria-busy={isRetrying}
							onClick={onRetry}
						>
							{isRetrying ? "Retrying…" : "Retry"}
						</Button>

						<SpotifyPlaylistLink spotifyId={spotifyId} />

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
