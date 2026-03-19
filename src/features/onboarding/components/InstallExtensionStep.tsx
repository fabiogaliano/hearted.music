/**
 * Install Extension step — 3-state dual-column flow (V3).
 * State 1: no extension. State 2: extension but no Spotify. State 3: ready.
 * Keyboard: Enter = allow sync (when ready), S = skip.
 */

import { useCallback, useEffect, useState } from "react";
import {
	connectExtension,
	getSpotifyConnectionStatus,
	isExtensionInstalled,
	triggerExtensionSync,
} from "@/lib/extension/detect";
import { resetSyncJobs } from "@/lib/server/onboarding.functions";
import { toast } from "sonner";
import { Kbd } from "@/components/ui/kbd";
import { useShortcut } from "@/lib/keyboard/useShortcut";
import { fonts } from "@/lib/theme/fonts";
import type { ThemeConfig } from "@/lib/theme/types";
import { useTheme } from "@/lib/theme/ThemeHueProvider";
import { ExtensionSetupTrail } from "./ExtensionSetupTrail";
import { StaggeredContent } from "./StaggeredContent";
import { useOnboardingNavigation } from "../hooks/useOnboardingNavigation";

const EXTENSION_STORE_URL =
	"https://chrome.google.com/webstore/detail/hearted-spotify-sync/EXTENSION_ID";
const SPOTIFY_LOGIN_URL =
	"https://accounts.spotify.com/en-GB/login?continue=https%3A%2F%2Fopen.spotify.com%2F";

// ── Action content — right column ─────────────────────────────────────────

function ActionContent({
	theme,
	isExtensionDetected,
	isSpotifyConnected,
	onAccept,
	isAdvancing,
}: {
	theme: ThemeConfig;
	isExtensionDetected: boolean;
	isSpotifyConnected: boolean;
	onAccept: () => void;
	isAdvancing: boolean;
}) {
	const isReadyToSync = isExtensionDetected && isSpotifyConnected;

	if (isReadyToSync) {
		return (
			<>
				<p
					className="text-[11px] uppercase tracking-[0.12em]"
					style={{
						fontFamily: fonts.body,
						color: theme.textMuted,
						opacity: 0.45,
					}}
				>
					here's what hearted can see.
				</p>
				<ul
					className="flex flex-col gap-3"
					style={{ listStyle: "none", padding: 0 }}
				>
					{["your profile", "your liked songs", "your playlists"].map(
						(item) => (
							<li key={item} className="flex items-center gap-2.5">
								<span
									style={{
										width: 4,
										height: 4,
										borderRadius: "100%",
										flexShrink: 0,
										background: theme.textMuted,
										opacity: 0.35,
									}}
								/>
								<span
									className="text-[13px]"
									style={{
										fontFamily: fonts.body,
										color: theme.textMuted,
										opacity: 0.65,
									}}
								>
									{item}
								</span>
							</li>
						),
					)}
				</ul>
				<button
					type="button"
					onClick={onAccept}
					disabled={isAdvancing}
					className="self-start inline-flex items-center gap-2 rounded-[24px] px-6 py-2.5 text-sm font-medium uppercase tracking-widest transition-all duration-200 hover:opacity-90 active:scale-[0.98]"
					style={{
						fontFamily: fonts.body,
						background: theme.primary,
						color: theme.textOnPrimary,
						border: "1px solid transparent",
						opacity: isAdvancing ? 0.4 : 1,
						cursor: isAdvancing ? "default" : "pointer",
					}}
				>
					allow sync →
				</button>
			</>
		);
	}

	if (!isExtensionDetected) {
		return (
			<>
				<div>
					<p
						className="text-[15px] font-light"
						style={{ fontFamily: fonts.body, color: theme.text, opacity: 0.7 }}
					>
						the sync starts here.
					</p>
					<p
						className="mt-1 text-[13px] leading-relaxed"
						style={{
							fontFamily: fonts.body,
							color: theme.textMuted,
							opacity: 0.5,
						}}
					>
						reads your liked songs. never your login.
					</p>
				</div>
				<a
					href={EXTENSION_STORE_URL}
					target="_blank"
					rel="noopener noreferrer"
					className="self-start inline-flex items-center gap-2 rounded-[24px] px-5 py-2 text-sm font-medium uppercase tracking-widest transition-all duration-200 hover:opacity-80 active:scale-[0.98]"
					style={{
						fontFamily: fonts.body,
						background: theme.surface,
						border: `1px solid ${theme.border}`,
						color: theme.text,
					}}
				>
					add to Chrome
					<span className="text-xs" style={{ opacity: 0.45 }}>
						↗
					</span>
				</a>
			</>
		);
	}

	// State 2: extension found, Spotify not yet connected
	return (
		<>
			<div>
				<p
					className="text-[15px] font-light"
					style={{ fontFamily: fonts.body, color: theme.text, opacity: 0.7 }}
				>
					one more thing.
				</p>
				<p
					className="mt-1 text-[13px] leading-relaxed"
					style={{
						fontFamily: fonts.body,
						color: theme.textMuted,
						opacity: 0.5,
					}}
				>
					the sync only works when you're logged into Spotify.
				</p>
			</div>
			<a
				href={SPOTIFY_LOGIN_URL}
				target="_blank"
				rel="noopener noreferrer"
				className="self-start inline-flex items-center gap-2 rounded-[24px] px-5 py-2 text-sm font-medium uppercase tracking-widest transition-all duration-200 hover:opacity-80 active:scale-[0.98]"
				style={{
					fontFamily: fonts.body,
					background: theme.surface,
					border: `1px solid ${theme.border}`,
					color: theme.text,
				}}
			>
				log in to Spotify
				<span className="text-xs" style={{ opacity: 0.45 }}>
					↗
				</span>
			</a>
		</>
	);
}

// ── InstallExtensionStep ──────────────────────────────────────────────────

export function InstallExtensionStep() {
	const theme = useTheme();
	const { goToStep } = useOnboardingNavigation();
	const [isExtensionDetected, setIsExtensionDetected] = useState(false);
	const [isSpotifyConnected, setIsSpotifyConnected] = useState(false);
	const [isAdvancing, setIsAdvancing] = useState(false);

	const handleAccept = useCallback(async () => {
		setIsAdvancing(true);
		try {
			const res = await fetch("/api/extension/token", { method: "POST" });
			if (!res.ok) throw new Error(`Token request failed: ${res.status}`);
			const { token } = await res.json();
			if (!token) throw new Error("No token in response");

			const connected = await connectExtension(token, window.location.origin);
			if (!connected) throw new Error("Extension did not acknowledge CONNECT");

			// Clear stale phaseJobIds so SyncingStep starts fresh ("Waiting for extension")
			// instead of subscribing to stale jobs from a previous run.
			await resetSyncJobs();

			// Kick off the sync now — the extension has both the API token (from CONNECT)
			// and the Spotify token (from content script). Without this, nothing bridges
			// "ready" to "syncing" and the user stalls on "Waiting for Spotify".
			triggerExtensionSync();

			await goToStep("syncing", { phaseJobIds: null });
		} catch (err) {
			console.error("[hearted.] handleAccept failed:", err);
			toast.error("Couldn't connect the extension. Please try again.");
			setIsAdvancing(false);
		}
	}, [goToStep]);

	// Extension polling (2s). Once detected, switches to Spotify polling (3s).
	// The Spotify branch also re-checks the extension so disabling mid-flow resets state.
	useEffect(() => {
		if (!isExtensionDetected) {
			let cancelled = false;
			const check = async () => {
				const detected = await isExtensionInstalled();
				if (!cancelled && detected) setIsExtensionDetected(true);
			};
			check();
			const id = setInterval(check, 2_000);
			return () => {
				cancelled = true;
				clearInterval(id);
			};
		}

		let cancelled = false;
		const check = async () => {
			const stillInstalled = await isExtensionInstalled();
			if (!cancelled && !stillInstalled) {
				setIsExtensionDetected(false);
				setIsSpotifyConnected(false);
				return;
			}
			const connected = await getSpotifyConnectionStatus();
			if (!cancelled) setIsSpotifyConnected(connected);
		};
		check();
		const intervalId = setInterval(check, 3_000);
		return () => {
			cancelled = true;
			clearInterval(intervalId);
		};
	}, [isExtensionDetected]);

	useShortcut({
		key: "enter",
		handler: handleAccept,
		description: "Allow sync",
		scope: "onboarding-extension",
		enabled: isExtensionDetected && isSpotifyConnected && !isAdvancing,
	});

	if (!theme) return null;

	return (
		<>
			<StaggeredContent>
				<p
					className="text-xs tracking-widest uppercase"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					Step 02
				</p>

				<h2
					className="mt-4 text-6xl leading-tight font-extralight"
					style={{ fontFamily: fonts.display, color: theme.text }}
				>
					everything you
					<br />
					ever <em className="font-normal">hearted.</em>
				</h2>

				<div className="mt-16 flex flex-col gap-10 md:flex-row md:gap-14">
					{/* Left column: supporting text + trail */}
					<div className="shrink-0 md:w-[220px]">
						<p
							className="text-[14px] leading-relaxed"
							style={{
								fontFamily: fonts.body,
								color: theme.textMuted,
								opacity: 0.55,
								maxWidth: "26ch",
							}}
						>
							a small Chrome extension reads your library and sends it here.
						</p>

						<div className="mt-6">
							<ExtensionSetupTrail
								theme={theme}
								isExtensionInstalled={isExtensionDetected}
								isSpotifyConnected={isSpotifyConnected}
							/>
						</div>
					</div>

					{/* Vertical divider — desktop only */}
					<div
						className="hidden md:block w-px self-stretch"
						style={{ background: theme.border }}
					/>

					{/* Right column: state-driven action content */}
					<div className="flex flex-1 flex-col justify-center gap-5">
						<ActionContent
							theme={theme}
							isExtensionDetected={isExtensionDetected}
							isSpotifyConnected={isSpotifyConnected}
							onAccept={handleAccept}
							isAdvancing={isAdvancing}
						/>
					</div>
				</div>
			</StaggeredContent>

			<div
				className="fixed bottom-6 left-0 right-0 flex items-center justify-center gap-6"
				style={
					{
						color: theme.textMuted,
						opacity: 0.6,
						"--kbd-text-color": theme.textMuted,
						"--kbd-bg-color": `${theme.text}10`,
						"--kbd-border-color": `${theme.textMuted}30`,
						"--kbd-shadow-color": `${theme.textMuted}20`,
					} as React.CSSProperties
				}
			>
				{isExtensionDetected && isSpotifyConnected && (
					<div className="flex items-center gap-1.5">
						<Kbd>⏎</Kbd>
						<span className="text-xs">allow sync</span>
					</div>
				)}
			</div>
		</>
	);
}
