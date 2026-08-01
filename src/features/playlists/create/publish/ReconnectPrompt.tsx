import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { ExtensionAccountBannerView } from "@/features/dashboard/components/ExtensionAccountBanner";
import { repairConnection } from "@/lib/extension/connection/repair";

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
		<ExtensionAccountBannerView
			verdict={{ kind: "spotify-disconnected" }}
			accountDisplayName={null}
			repairing={repairing}
			onReconnect={onReconnect}
			variant="bar"
		/>
	);
}
