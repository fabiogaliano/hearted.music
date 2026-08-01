import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { ExtensionAccountBannerView } from "@/features/dashboard/components/ExtensionAccountBanner";
import { repairConnection } from "@/lib/extension/connection/repair";
import type { ExtensionSpotifyProfile } from "@/lib/extension/detect";

const SPOTIFY_LOGIN_URL = "https://open.spotify.com/";

interface AccountMismatchPromptProps {
	extensionProfile: ExtensionSpotifyProfile;
	accountDisplayName: string | null;
}

export function AccountMismatchPrompt({
	extensionProfile,
	accountDisplayName,
}: AccountMismatchPromptProps) {
	const queryClient = useQueryClient();
	const [repairing, setRepairing] = useState(false);

	const onReconnect = useCallback(() => {
		setRepairing(true);
		repairConnection({
			verdict: { kind: "mismatch", extensionProfile },
			queryClient,
			spotifyLoginUrl: SPOTIFY_LOGIN_URL,
		})
			.catch(() => {})
			.finally(() => setRepairing(false));
	}, [extensionProfile, queryClient]);

	return (
		<ExtensionAccountBannerView
			verdict={{ kind: "mismatch", extensionProfile }}
			accountDisplayName={accountDisplayName}
			repairing={repairing}
			onReconnect={onReconnect}
			variant="bar"
		/>
	);
}
