import { useMemo } from "react";
import { fonts } from "@/lib/theme/fonts";
import { armReconnectOnActivation } from "./reconnect-link";

const SPOTIFY_LOGIN_URL = "https://open.spotify.com/";

interface SpotifyReconnectLinkProps {
	label?: string;
}

export function SpotifyReconnectLink({
	label = "Reconnect to Spotify",
}: SpotifyReconnectLinkProps) {
	const onActivate = useMemo(
		() => armReconnectOnActivation(SPOTIFY_LOGIN_URL),
		[],
	);

	return (
		<a
			href={SPOTIFY_LOGIN_URL}
			target="_blank"
			rel="noopener noreferrer"
			onClick={onActivate}
			onAuxClick={onActivate}
			className="hover-border-brighten inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs tracking-widest uppercase active:scale-[0.98]"
			style={{ fontFamily: fonts.body }}
		>
			{label}
			<span className="text-xs" style={{ opacity: 0.45 }}>
				↗
			</span>
		</a>
	);
}
