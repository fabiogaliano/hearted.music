import { useCallback, useEffect, useRef, useState } from "react";
import { SpotifyReconnectLink } from "@/lib/extension/SpotifyReconnectLink";
import { fonts } from "@/lib/theme/fonts";

interface ReconnectPromptProps {
	onRecheck: () => Promise<void>;
}

export function ReconnectPrompt({ onRecheck }: ReconnectPromptProps) {
	const [isChecking, setIsChecking] = useState(false);
	const mountedRef = useRef(true);
	useEffect(() => {
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
			className="flex items-center gap-4 px-5 py-4"
			role="status"
			aria-live="polite"
			style={{ borderLeft: "2px solid var(--t-primary)" }}
		>
			<p className="theme-text text-xs" style={{ fontFamily: fonts.body }}>
				<strong className="font-medium">Spotify disconnected.</strong>{" "}
				<span className="theme-text-muted">Reconnect to keep creating.</span>
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
