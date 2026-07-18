/**
 * ReconnectPrompt — inline affordance for the create touchpoint when Spotify
 * is disconnected. Uses the shared SpotifyReconnectLink so the token-refresh
 * flow works identically to other surfaces.
 *
 * Reconnecting opens Spotify in a new tab/popup, so the original tab may never
 * fire a focus/visibility event on return. The "Check again" button lets the
 * user re-run the gate detection by hand once the token is back.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { SpotifyReconnectLink } from "@/lib/extension/SpotifyReconnectLink";
import { fonts } from "@/lib/theme/fonts";

interface ReconnectPromptProps {
	/** Re-runs the gate detection; resolves once the check settles. */
	onRecheck: () => Promise<void>;
}

export function ReconnectPrompt({ onRecheck }: ReconnectPromptProps) {
	const [isChecking, setIsChecking] = useState(false);
	const mountedRef = useRef(true);
	useEffect(() => {
		// Reset on effect re-run so StrictMode's mount→cleanup→mount cycle
		// doesn't leave the ref permanently false.
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
		};
	}, []);

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
			className="flex items-center gap-4 px-6 py-5"
			role="status"
			aria-live="polite"
		>
			<p
				className="theme-text-muted text-xs"
				style={{ fontFamily: fonts.body }}
			>
				Spotify is disconnected — reconnect to create your playlist.
			</p>
			<SpotifyReconnectLink />
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
