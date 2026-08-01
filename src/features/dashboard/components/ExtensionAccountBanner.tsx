/**
 * The dashboard's single reconnect home.
 *
 * Every actionable connection verdict (Spotify session expired, extension
 * unpaired, wrong Spotify account signed in, or unverifiable/old-extension)
 * renders here with one button backed by `repairConnection()` — this is what
 * makes "banner Reconnect, then sync control Reconnect Spotify" (the
 * two-reconnects bug) structurally impossible: the sync control never renders
 * a reconnect button for a linked account (see useDashboardSync's `paused`
 * state), so this is the only place a user ever sees one.
 *
 * Renders nothing for `ok`/`checking`/`extension-missing` and for pre-link
 * accounts (`linkedSpotifyId === null`) — before first sync, onboarding owns
 * the connect UX and a banner would be noise.
 *
 * Split view/container so Ladle can drive every state without the extension.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { repairConnection } from "@/lib/extension/connection/repair";
import type { ConnectionVerdict } from "@/lib/extension/connection/verdict";
import { fonts } from "@/lib/theme/fonts";

// Same wrapped login URL as the sync control's pre-link CTA and onboarding's
// InstallExtensionStep — arms the `continue` destination via repairConnection.
const SPOTIFY_LOGIN_URL =
	"https://accounts.spotify.com/en-GB/login?continue=https%3A%2F%2Fopen.spotify.com%2F";

/** The subset of verdicts this banner ever renders something for. */
export type ActionableConnectionVerdict = Extract<
	ConnectionVerdict,
	{ kind: "mismatch" | "unpaired" | "spotify-disconnected" | "unverifiable" }
>;

interface ExtensionAccountBannerViewProps {
	verdict: ActionableConnectionVerdict;
	/** Display name of the hearted account's linked Spotify identity, for the
	 * "this library belongs to…" half of the mismatch copy. */
	accountDisplayName: string | null;
	repairing: boolean;
	onReconnect: () => void;
	/** When true, drops the dashboard-specific negative margins and bottom spacing. */
	flush?: boolean;
}

export function ExtensionAccountBannerView({
	verdict,
	accountDisplayName,
	repairing,
	onReconnect,
	flush,
}: ExtensionAccountBannerViewProps) {
	return (
		<div
			role="status"
			aria-live="polite"
			className={`theme-surface-bg px-5 py-4${flush ? "" : " -mx-4 mb-10"}`}
		>
			{verdict.kind === "mismatch" ? (
				<div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
					<p
						className="theme-text text-sm text-balance"
						style={{ fontFamily: fonts.body }}
					>
						Your browser is signed in to Spotify as{" "}
						<strong className="font-medium">
							{verdict.extensionProfile.displayName}
						</strong>
						{accountDisplayName ? (
							<>
								, but this library belongs to{" "}
								<strong className="font-medium">{accountDisplayName}</strong>
							</>
						) : (
							", which isn't the account this library was built from"
						)}
						. Syncing is paused until they match.
					</p>
					<button
						type="button"
						onClick={onReconnect}
						disabled={repairing}
						className="hover-border-brighten inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-xs tracking-widest whitespace-nowrap uppercase active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
						style={{ fontFamily: fonts.body }}
					>
						{repairing ? "Switching…" : "Switch Spotify account"}
					</button>
				</div>
			) : verdict.kind === "unverifiable" ? (
				// Old extension (paired: null) or a background hiccup (profile: null)
				// — never conflate with the explicit unpaired disconnect (invariant 6),
				// so no CTA: there's nothing a click here could silently repair.
				<p
					className="theme-text text-sm text-balance"
					style={{ fontFamily: fonts.body }}
				>
					We can't verify your Spotify account right now — this can happen with
					an older version of the extension. Syncing is paused until it's
					confirmed.
				</p>
			) : (
				<div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
					<p
						className="theme-text text-sm text-balance"
						style={{ fontFamily: fonts.body }}
					>
						{verdict.kind === "unpaired"
							? "The extension is no longer connected to your hearted account, so syncing is paused."
							: "Your Spotify session expired, so syncing is paused."}
					</p>
					<button
						type="button"
						onClick={onReconnect}
						disabled={repairing}
						className="hover-border-brighten inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-xs tracking-widest whitespace-nowrap uppercase active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
						style={{ fontFamily: fonts.body }}
					>
						{repairing
							? "Reconnecting…"
							: verdict.kind === "unpaired"
								? "Reconnect"
								: "Reconnect Spotify"}
					</button>
				</div>
			)}
		</div>
	);
}

interface ExtensionAccountBannerProps {
	verdict: ConnectionVerdict;
	/** null before first sync — the banner stays hidden then regardless of
	 * verdict (see module header). */
	linkedSpotifyId: string | null;
	accountDisplayName: string | null;
}

function isActionable(
	verdict: ConnectionVerdict,
): verdict is ActionableConnectionVerdict {
	return (
		verdict.kind === "mismatch" ||
		verdict.kind === "unpaired" ||
		verdict.kind === "spotify-disconnected" ||
		verdict.kind === "unverifiable"
	);
}

export function ExtensionAccountBanner({
	verdict,
	linkedSpotifyId,
	accountDisplayName,
}: ExtensionAccountBannerProps) {
	const queryClient = useQueryClient();
	const [repairing, setRepairing] = useState(false);

	// Pre-link accounts never had a banner — before first sync, onboarding owns
	// the connect UX and a banner is noise. The verdict alone can't express this
	// (a pre-link account can still read `spotify-disconnected`), so gate on
	// linkedSpotifyId explicitly; the sync control keeps a CTA of its own for
	// this case (see useDashboardSync's `spotify-reconnect-required`).
	if (linkedSpotifyId === null || !isActionable(verdict)) return null;

	const onReconnect = () => {
		setRepairing(true);
		// repairConnection opens Spotify synchronously (invariant 1) — nothing
		// awaited before this call. Its returned promise can genuinely reject
		// (pairExtension() throwing), so it's caught here rather than left
		// unhandled; there's no extra recovery to show beyond stopping the
		// spinner — the next poll/focus refetch re-derives the verdict, and a
		// still-broken connection just re-renders this same banner.
		repairConnection({
			verdict,
			queryClient,
			spotifyLoginUrl: SPOTIFY_LOGIN_URL,
		})
			.catch(() => {})
			.finally(() => setRepairing(false));
	};

	return (
		<ExtensionAccountBannerView
			verdict={verdict}
			accountDisplayName={accountDisplayName}
			repairing={repairing}
			onReconnect={onReconnect}
		/>
	);
}
