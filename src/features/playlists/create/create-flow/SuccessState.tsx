/**
 * SuccessState — shown after the playlist is created on Spotify.
 *
 * Calm and restrained: a confirmation with the playlist name, a link to
 * open the playlist in Spotify, and a "Done" button back to /playlists.
 * The entrance animation is a simple opacity + 6px lift that collapses to
 * an instant opacity-only change under reduced motion.
 */

import { ArrowSquareOutIcon, CheckCircleIcon } from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/Button";
import { fonts } from "@/lib/theme/fonts";

interface SuccessStateProps {
	playlistName: string;
	spotifyId: string;
}

export function SuccessState({ playlistName, spotifyId }: SuccessStateProps) {
	const navigate = useNavigate();
	const spotifyUrl = `https://open.spotify.com/playlist/${spotifyId}`;

	return (
		<div
			className="px-6 py-8"
			role="status"
			aria-live="polite"
			aria-atomic="true"
			style={{
				animation:
					"var(--success-state-enter, success-state-enter 300ms ease-out both)",
			}}
		>
			<style>{`
				@keyframes success-state-enter {
					from { opacity: 0; transform: translateY(6px); }
					to   { opacity: 1; transform: translateY(0); }
				}
				@media (prefers-reduced-motion: reduce) {
					@keyframes success-state-enter {
						from { opacity: 0; }
						to   { opacity: 1; }
					}
				}
			`}</style>

			<div className="flex items-start gap-4">
				<CheckCircleIcon
					size={20}
					weight="regular"
					className="theme-text mt-0.5 shrink-0"
					aria-hidden
				/>

				<div className="flex flex-col gap-3">
					<div>
						<p
							className="theme-text-muted mb-1 text-[11px] tracking-widest uppercase"
							style={{ fontFamily: fonts.body }}
						>
							Playlist created
						</p>
						<p
							className="theme-text text-base"
							style={{ fontFamily: fonts.display, fontWeight: 300 }}
						>
							{playlistName}
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
