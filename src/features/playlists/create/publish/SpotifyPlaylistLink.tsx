import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import { fonts } from "@/lib/theme/fonts";

interface SpotifyPlaylistLinkProps {
	spotifyId: string;
}

export function SpotifyPlaylistLink({ spotifyId }: SpotifyPlaylistLinkProps) {
	return (
		<a
			href={`https://open.spotify.com/playlist/${spotifyId}`}
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
	);
}
