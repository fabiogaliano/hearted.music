import { useQueryClient } from "@tanstack/react-query";
import type { MouseEvent } from "react";
import { useCallback } from "react";
import { fonts } from "@/lib/theme/fonts";
import { repairConnection } from "./connection/repair";
import { shouldArmOnEvent } from "./reconnect-link";

const SPOTIFY_LOGIN_URL = "https://open.spotify.com/";

interface SpotifyReconnectLinkProps {
	label?: string;
}

// This anchor's only production use is "the token is dead, get a fresh one" —
// every current call site (studio's ReconnectPrompt, liked-songs/matching's
// inline prompts) renders it exactly when the shared verdict is
// spotify-disconnected, so activation routes through repairConnection under
// that verdict. repairConnection both opens the armed Spotify login
// synchronously (invariant 1 — nothing awaited first) and fires the silent
// re-pair in parallel, so a fresh install's dead-token AND never-paired cases
// both resolve from the same click (05's "unified affordance").
export function SpotifyReconnectLink({
	label = "Reconnect to Spotify",
}: SpotifyReconnectLinkProps) {
	const queryClient = useQueryClient();
	const onActivate = useCallback(
		(event: MouseEvent<HTMLElement>) => {
			if (!shouldArmOnEvent(event)) return;
			event.preventDefault();
			// repairConnection's returned promise can reject (pairExtension()
			// throwing) — caught here per 02-repair-action.md's call-site contract;
			// there is no extra recovery to show beyond letting the click settle.
			repairConnection({
				verdict: { kind: "spotify-disconnected" },
				queryClient,
				spotifyLoginUrl: SPOTIFY_LOGIN_URL,
			}).catch(() => {});
		},
		[queryClient],
	);

	return (
		<a
			href={SPOTIFY_LOGIN_URL}
			target="_blank"
			rel="noopener noreferrer"
			onClick={onActivate}
			onAuxClick={onActivate}
			className="chip-raised chip-raised-hover squircle focus-edge inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs tracking-widest uppercase active:scale-[0.98]"
			style={{ fontFamily: fonts.body }}
		>
			{label}
			<span className="text-xs" style={{ opacity: 0.45 }}>
				↗
			</span>
		</a>
	);
}
