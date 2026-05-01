import { fonts } from "@/lib/theme/fonts";
import { armReconnectOnActivation } from "./reconnect-link";

const SPOTIFY_LOGIN_URL = "https://open.spotify.com/";

interface SpotifyReconnectLinkProps {
	label?: string;
	surface: string;
	border: string;
	text: string;
}

export function SpotifyReconnectLink({
	label = "Reconnect to Spotify",
	surface,
	border,
	text,
}: SpotifyReconnectLinkProps) {
	return (
		<a
			href={SPOTIFY_LOGIN_URL}
			target="_blank"
			rel="noopener noreferrer"
			onClick={armReconnectOnActivation}
			onAuxClick={armReconnectOnActivation}
			onMouseDown={armReconnectOnActivation}
			className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-[20px] px-3 py-1.5 text-xs tracking-widest uppercase transition-all hover:opacity-80 active:scale-[0.98]"
			style={{
				fontFamily: fonts.body,
				background: surface,
				border: `1px solid ${border}`,
				color: text,
			}}
		>
			{label}
			<span className="text-xs" style={{ opacity: 0.45 }}>
				↗
			</span>
		</a>
	);
}
