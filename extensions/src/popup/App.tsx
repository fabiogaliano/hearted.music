import { useEffect, useState } from "react";
import { browser } from "../shared/browser";

// Rose / "Warm" pastel theme — mirrored from src/lib/theme/colors.ts.
// Inlined for the same reason as return-banner.ts: no cross-build import.
const THEME = {
	text: "hsl(340, 28%, 22%)",
	textMuted: "hsl(340, 20%, 45%)",
	primary: "hsl(340, 28%, 28%)",
	border: "hsl(340, 20%, 75%)",
} as const;

const FONT_DISPLAY = "'Instrument Serif', Georgia, serif";
const FONT_BODY =
	"'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";

export function App() {
	const [hasSpotifyToken, setHasSpotifyToken] = useState<boolean | null>(null);

	useEffect(() => {
		let cancelled = false;
		// Promise-style sendMessage works on both Chrome MV3 (promise-native) and
		// Firefox's browser.* — the Chrome callback signature the popup used before
		// is silently ignored by Firefox, so it would never resolve there.
		browser.runtime
			.sendMessage({ type: "GET_STATUS" })
			.then((response: { hasToken?: boolean } | undefined) => {
				if (cancelled) return;
				setHasSpotifyToken(response?.hasToken ?? false);
			})
			.catch(() => {
				if (!cancelled) setHasSpotifyToken(false);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const isLoading = hasSpotifyToken === null;
	const isConnected = hasSpotifyToken === true;

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
			<h1
				style={{
					fontFamily: FONT_DISPLAY,
					fontSize: 26,
					fontWeight: 400,
					lineHeight: 1.1,
					letterSpacing: "-0.005em",
					color: THEME.text,
				}}
			>
				everything you
				<br />
				ever <em style={{ fontStyle: "italic" }}>hearted.</em>
			</h1>

			<div
				aria-hidden="true"
				style={{
					height: 1,
					background: THEME.border,
					opacity: 0.6,
				}}
			/>

			<output
				aria-live="polite"
				style={{
					display: "flex",
					alignItems: "center",
					gap: 10,
					fontFamily: FONT_BODY,
				}}
			>
				<StatusDot state={isLoading ? "loading" : isConnected ? "on" : "off"} />
				<span
					style={{
						fontSize: 13,
						fontWeight: 400,
						color: isConnected ? THEME.text : THEME.textMuted,
					}}
				>
					{isLoading
						? "checking…"
						: isConnected
							? "Spotify connected"
							: "open Spotify to connect"}
				</span>
			</output>
		</div>
	);
}

type StatusDotState = "on" | "off" | "loading";

function StatusDot({ state }: { state: StatusDotState }) {
	const size = 8;
	const common: React.CSSProperties = {
		width: size,
		height: size,
		borderRadius: "50%",
		flexShrink: 0,
	};

	if (state === "on") {
		return <span style={{ ...common, background: THEME.primary }} />;
	}
	if (state === "off") {
		return (
			<span
				style={{
					...common,
					background: "transparent",
					border: `1.5px solid ${THEME.textMuted}`,
					opacity: 0.7,
				}}
			/>
		);
	}
	// loading — muted solid, gently pulsing via inline keyframes injected once
	return (
		<>
			<style>{`
				@keyframes hearted-dot-pulse {
					0%, 100% { opacity: 0.35; }
					50%      { opacity: 0.8; }
				}
				@media (prefers-reduced-motion: reduce) {
					.hearted-loading-dot { animation: none !important; opacity: 0.5 !important; }
				}
			`}</style>
			<span
				className="hearted-loading-dot"
				style={{
					...common,
					background: THEME.textMuted,
					animation: "hearted-dot-pulse 1.1s ease-in-out infinite",
				}}
			/>
		</>
	);
}
