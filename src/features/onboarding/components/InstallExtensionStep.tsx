/**
 * Install Extension step — 3-state dual-column flow (V3).
 * State 1: no extension. State 2: extension but no Spotify. State 3: ready.
 * Keyboard: Enter = allow sync (when ready), S = skip.
 */

import { ArrowRight } from "@phosphor-icons/react";
import {
	type MouseEvent,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Kbd } from "@/components/ui/kbd";
import {
	connectExtension,
	getSpotifyConnectionStatus,
	isExtensionInstalled,
	triggerExtensionSync,
} from "@/lib/extension/detect";
import { armReconnectOnActivation } from "@/lib/extension/reconnect-link";
import { useShortcut } from "@/lib/keyboard/useShortcut";
import { resetSyncJobs } from "@/lib/server/onboarding.functions";
import { fonts } from "@/lib/theme/fonts";
import { useOnboardingNavigation } from "../hooks/useOnboardingNavigation";
import { ExtensionSetupTrail } from "./ExtensionSetupTrail";
import { StaggeredContent } from "./StaggeredContent";

const EXTENSION_STORE_URL =
	"https://chromewebstore.google.com/detail/everything-you-ever-heart/ohaaafmgbbfohhjhogonolonpjhhfohk";
const SPOTIFY_LOGIN_URL =
	"https://accounts.spotify.com/en-GB/login?continue=https%3A%2F%2Fopen.spotify.com%2F";

// ── Action content — right column ─────────────────────────────────────────

function ActionContent({
	isExtensionDetected,
	isSpotifyConnected,
	onAccept,
	onSpotifyLoginClick,
	spotifyLoginHref,
	isAdvancing,
}: {
	isExtensionDetected: boolean;
	isSpotifyConnected: boolean;
	onAccept: () => void;
	onSpotifyLoginClick: (event: MouseEvent<HTMLAnchorElement>) => void;
	spotifyLoginHref: string;
	isAdvancing: boolean;
}) {
	const isReadyToSync = isExtensionDetected && isSpotifyConnected;

	if (isReadyToSync) {
		return (
			<>
				<p
					className="theme-text-muted text-xs uppercase tracking-[0.12em]"
					style={{ fontFamily: fonts.body, opacity: 0.45 }}
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
									className="theme-text-muted-bg"
									style={{
										width: 4,
										height: 4,
										borderRadius: "100%",
										flexShrink: 0,
										opacity: 0.35,
									}}
								/>
								<span
									className="theme-text-muted text-[13px]"
									style={{ fontFamily: fonts.body, opacity: 0.65 }}
								>
									{item}
								</span>
							</li>
						),
					)}
				</ul>
				<Button
					onClick={onAccept}
					disabled={isAdvancing}
					className="self-start rounded-full"
					style={{ fontFamily: fonts.body }}
				>
					allow sync <ArrowRight size={14} className="inline" />
				</Button>
			</>
		);
	}

	if (!isExtensionDetected) {
		return (
			<>
				<div>
					<p
						className="theme-text text-[15px] font-light"
						style={{ fontFamily: fonts.body, opacity: 0.7 }}
					>
						the sync starts here.
					</p>
					<p
						className="theme-text-muted mt-1 text-[13px] leading-relaxed"
						style={{ fontFamily: fonts.body, opacity: 0.5 }}
					>
						reads your liked songs. never your login.
					</p>
				</div>
				<a
					href={EXTENSION_STORE_URL}
					target="_blank"
					rel="noopener noreferrer"
					className="hover-border-brighten self-start inline-flex cursor-pointer items-center gap-2 rounded-full px-5 py-2 text-sm font-medium uppercase tracking-widest active:scale-[0.98]"
					style={{ fontFamily: fonts.body }}
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
					className="theme-text text-[15px] font-light"
					style={{ fontFamily: fonts.body, opacity: 0.7 }}
				>
					one more thing.
				</p>
				<p
					className="theme-text-muted mt-1 text-[13px] leading-relaxed"
					style={{ fontFamily: fonts.body, opacity: 0.5 }}
				>
					the sync only works when you're logged into Spotify.
				</p>
			</div>
			<a
				href={spotifyLoginHref}
				target="_blank"
				rel="noopener noreferrer"
				onClick={onSpotifyLoginClick}
				onAuxClick={onSpotifyLoginClick}
				className="hover-border-brighten self-start inline-flex cursor-pointer items-center gap-2 rounded-full px-5 py-2 text-sm font-medium uppercase tracking-widest active:scale-[0.98]"
				style={{ fontFamily: fonts.body }}
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
	const { goToStep } = useOnboardingNavigation();
	const [isExtensionDetected, setIsExtensionDetected] = useState(false);
	const [isSpotifyConnected, setIsSpotifyConnected] = useState(false);
	const [isAdvancing, setIsAdvancing] = useState(false);

	const spotifyLoginHref = SPOTIFY_LOGIN_URL;
	const handleSpotifyLoginClick = useMemo(
		() => armReconnectOnActivation(SPOTIFY_LOGIN_URL),
		[],
	);

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

	return (
		<>
			<StaggeredContent>
				<h2
					className="theme-text text-6xl leading-tight font-extralight"
					style={{ fontFamily: fonts.display }}
				>
					everything you
					<br />
					ever <em className="font-normal">hearted.</em>
				</h2>

				<div className="mt-16 flex flex-col gap-10 md:flex-row md:gap-14">
					{/* Left column: supporting text + trail */}
					<div className="shrink-0 md:w-[220px]">
						<p
							className="theme-text-muted text-[14px] leading-relaxed"
							style={{
								fontFamily: fonts.body,
								opacity: 0.55,
								maxWidth: "26ch",
							}}
						>
							a small Chrome extension reads your library and sends it here.
						</p>

						<div className="mt-6">
							<ExtensionSetupTrail
								isExtensionInstalled={isExtensionDetected}
								isSpotifyConnected={isSpotifyConnected}
							/>
						</div>
					</div>

					{/* Vertical divider — desktop only */}
					<div className="theme-border-bg hidden w-px self-stretch md:block" />

					{/* Right column: state-driven action content */}
					<div className="flex flex-1 flex-col justify-center gap-5">
						<ActionContent
							isExtensionDetected={isExtensionDetected}
							isSpotifyConnected={isSpotifyConnected}
							onAccept={handleAccept}
							onSpotifyLoginClick={handleSpotifyLoginClick}
							spotifyLoginHref={spotifyLoginHref}
							isAdvancing={isAdvancing}
						/>
					</div>
				</div>
			</StaggeredContent>

			<div className="theme-kbd-scope fixed right-0 bottom-6 left-0 flex items-center justify-center gap-6 opacity-60">
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
