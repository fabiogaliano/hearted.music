/**
 * The studio's dead-Spotify-session recovery, shown in place of the Create CTA.
 *
 * Deliberately does not reuse the dashboard's ExtensionAccountBanner: that
 * banner's copy is about syncing being paused, which is the wrong stake here —
 * on this route the session is what stands between the user and a playlist on
 * Spotify. Same repair path, same visual treatment as the bar variant it
 * replaced; only the wording is local.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { repairConnection } from "@/lib/extension/connection/repair";
import { fonts } from "@/lib/theme/fonts";

const SPOTIFY_LOGIN_URL = "https://open.spotify.com/";

export function ReconnectPrompt() {
	const queryClient = useQueryClient();
	const [repairing, setRepairing] = useState(false);

	const onReconnect = useCallback(() => {
		setRepairing(true);
		repairConnection({
			verdict: { kind: "spotify-disconnected" },
			queryClient,
			spotifyLoginUrl: SPOTIFY_LOGIN_URL,
		})
			.catch(() => {})
			.finally(() => setRepairing(false));
	}, [queryClient]);

	return (
		<div
			role="status"
			aria-live="polite"
			className="theme-surface-bg flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-3.5"
		>
			<p
				className="theme-text text-balance text-xs"
				style={{ fontFamily: fonts.body }}
			>
				Reconnect to create this playlist.
			</p>
			<button
				type="button"
				onClick={onReconnect}
				disabled={repairing}
				className="chip-raised chip-raised-hover squircle focus-edge inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[11px] tracking-widest uppercase active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
				style={{ fontFamily: fonts.body }}
			>
				{repairing ? "Reconnecting…" : "Reconnect Spotify"}
			</button>
		</div>
	);
}
