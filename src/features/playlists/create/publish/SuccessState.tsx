/**
 * SuccessState — shown after the playlist is created on Spotify.
 *
 * The playlist keeps living after this moment (it persists match_intent/
 * filters and keeps surfacing suggestions on its detail page), so the
 * PRIMARY action routes into that managed-playlist loop instead of dead-ending
 * to Spotify or the bare list. "Open in Spotify" stays available as a
 * secondary action for the user who just wants to see it in their library.
 * The entrance animation is a simple opacity + 6px lift that collapses to
 * an instant opacity-only change under reduced motion.
 */

import { ArrowSquareOutIcon, CheckCircleIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import type { Playlist } from "@/lib/domains/library/playlists/queries";
import { fonts } from "@/lib/theme/fonts";
import { buildPlaylistRouteRef } from "../../playlistRouteRef";

interface SuccessStateProps {
	playlistName: string;
	spotifyId: string;
	/** Internal DB playlist id — resolves the /playlists/$playlistRef detail route. */
	playlistId: string;
}

export function SuccessState({
	playlistName,
	spotifyId,
	playlistId,
}: SuccessStateProps) {
	const spotifyUrl = `https://open.spotify.com/playlist/${spotifyId}`;
	// buildPlaylistRouteRef only reads .id and .name — the rest of the row
	// isn't available here (this is the write path, not a read of the list),
	// so a minimal cast avoids fetching the full row just to build a slug.
	const playlistRef = buildPlaylistRouteRef({
		id: playlistId,
		name: playlistName,
	} as Playlist);

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
						<p
							className="theme-text-muted mt-1 text-xs"
							style={{ fontFamily: fonts.body }}
						>
							We'll keep suggesting songs that fit — see them here.
						</p>
					</div>

					<div className="flex items-center gap-3">
						<Link
							to="/playlists/$playlistRef"
							params={{ playlistRef }}
							className="theme-primary-action inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs tracking-widest uppercase transition-opacity duration-150 hover:opacity-90 active:scale-[0.98]"
							style={{ fontFamily: fonts.body }}
						>
							View playlist
						</Link>

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
					</div>
				</div>
			</div>
		</div>
	);
}
