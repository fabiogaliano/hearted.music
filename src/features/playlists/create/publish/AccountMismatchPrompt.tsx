import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { repairConnection } from "@/lib/extension/connection/repair";
import type { ConnectionVerdict } from "@/lib/extension/connection/verdict";
import type { ExtensionSpotifyProfile } from "@/lib/extension/detect";
import { fonts } from "@/lib/theme/fonts";

const SPOTIFY_LOGIN_URL = "https://open.spotify.com/";

interface AccountMismatchPromptProps {
	extensionProfile: ExtensionSpotifyProfile;
	accountDisplayName: string | null;
	onRecheck: () => Promise<void>;
}

export function AccountMismatchPrompt({
	extensionProfile,
	accountDisplayName,
	onRecheck,
}: AccountMismatchPromptProps) {
	const queryClient = useQueryClient();
	const [isSwitching, setIsSwitching] = useState(false);
	const [isChecking, setIsChecking] = useState(false);
	const mountedRef = useRef(true);
	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
		};
	}, []);

	const handleSwitch = useCallback(() => {
		setIsSwitching(true);
		const verdict: ConnectionVerdict = {
			kind: "mismatch",
			extensionProfile,
		};
		repairConnection({
			verdict,
			queryClient,
			spotifyLoginUrl: SPOTIFY_LOGIN_URL,
		})
			.catch(() => {})
			.finally(() => {
				if (mountedRef.current) setIsSwitching(false);
			});
	}, [extensionProfile, queryClient]);

	const handleRecheck = useCallback(async () => {
		setIsChecking(true);
		try {
			await onRecheck();
		} finally {
			if (mountedRef.current) setIsChecking(false);
		}
	}, [onRecheck]);

	return (
		<div
			className="flex items-center gap-4 px-5 py-4"
			role="status"
			aria-live="polite"
			style={{ borderLeft: "2px solid var(--t-primary)" }}
		>
			<p
				className="theme-text text-xs text-balance"
				style={{ fontFamily: fonts.body }}
			>
				<strong className="font-medium">
					Signed in to Spotify as {extensionProfile.displayName}.
				</strong>{" "}
				<span className="theme-text-muted">
					{accountDisplayName
						? `This library belongs to ${accountDisplayName}.`
						: "Wrong account for this library."}
				</span>
			</p>
			<button
				type="button"
				onClick={handleSwitch}
				disabled={isSwitching}
				className="hover-border-brighten inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs tracking-widest uppercase active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
				style={{ fontFamily: fonts.body }}
			>
				{isSwitching ? "Switching…" : "Switch account"}
			</button>
			<button
				type="button"
				onClick={handleRecheck}
				disabled={isChecking}
				aria-busy={isChecking}
				className="theme-text-muted inline-flex cursor-pointer items-center whitespace-nowrap text-[11px] tracking-widest uppercase transition-opacity duration-150 hover:opacity-70 disabled:cursor-default disabled:opacity-40"
				style={{ fontFamily: fonts.body }}
			>
				{isChecking ? "Checking…" : "Check again"}
			</button>
		</div>
	);
}
