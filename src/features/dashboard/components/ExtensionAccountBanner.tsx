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
	/** `"bar"` retunes the banner for the create bar: flush edges and the bar's
	 * tighter type scale, so it reads as a sibling of the hint text it replaces
	 * rather than a page-level banner dropped into a footer. */
	variant?: "header" | "bar";
}

export function ExtensionAccountBannerView({
	verdict,
	accountDisplayName,
	repairing,
	onReconnect,
	variant = "header",
}: ExtensionAccountBannerViewProps) {
	const isBar = variant === "bar";
	const copyClass = `theme-text text-balance ${isBar ? "text-xs" : "text-sm"}`;
	const actionClass = `chip-raised chip-raised-hover squircle focus-edge inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 tracking-widest whitespace-nowrap uppercase active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${
		isBar ? "text-[11px]" : "text-xs"
	}`;

	return (
		<div
			role="status"
			aria-live="polite"
			className={
				isBar
					? // The bar variant stays flush and square on purpose (see `variant`):
						// it sits inside the create bar's own surface, so a second rounded
						// plane there would read as a card dropped into a footer.
						"theme-surface-bg px-5 py-3.5"
					: // A bar beside the page title, not a full-bleed strip under it —
						// hence no -mx-4, and no margin of its own: it's a flex child of the
						// header row now, which owns the spacing. max-w-md is sized to seat
						// the short verdicts' copy and button on one line, which is what
						// keeps the bar one row tall; the cap stops the mismatch verdict's
						// much longer copy from stretching across the whole row, and the
						// header drops the bar below the title when the viewport can't seat
						// both.
						"surface-raised squircle max-w-md rounded-[14px] px-4 py-2"
			}
		>
			{verdict.kind === "mismatch" ? (
				<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
					<p className={copyClass} style={{ fontFamily: fonts.body }}>
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
						className={actionClass}
						style={{ fontFamily: fonts.body }}
					>
						{repairing ? "Switching…" : "Switch Spotify account"}
					</button>
				</div>
			) : verdict.kind === "unverifiable" ? (
				// Old extension (paired: null) or a background hiccup (profile: null)
				// — never conflate with the explicit unpaired disconnect (invariant 6),
				// so no CTA: there's nothing a click here could silently repair.
				<p className={copyClass} style={{ fontFamily: fonts.body }}>
					We can't verify your Spotify account right now — this can happen with
					an older version of the extension. Syncing is paused until it's
					confirmed.
				</p>
			) : (
				<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
					{/* Cause only, one short line, so the bar stays a single row next to
					    the page title. It doesn't spell out the consequence ("syncing is
					    paused") because nothing on the dashboard is syncing to report on
					    yet — this bar has replaced the sync line for the duration — nor
					    the fix, which is the button's job. */}
					<p className={copyClass} style={{ fontFamily: fonts.body }}>
						{verdict.kind === "unpaired"
							? "The extension isn't connected."
							: "Your Spotify session expired."}
					</p>
					<button
						type="button"
						onClick={onReconnect}
						disabled={repairing}
						className={actionClass}
						style={{ fontFamily: fonts.body }}
					>
						{repairing ? "Reconnecting…" : "Reconnect"}
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

/** Whether this banner will render anything — exported because the dashboard
 * has to know: the last-sync line is hosted in here while it's up and left on
 * the activity feed otherwise, and the two placements must not both fire or
 * both miss. One predicate, so that answer can't be derived twice and drift.
 *
 * Pre-link accounts are excluded regardless of verdict: before first sync,
 * onboarding owns the connect UX and a banner is noise. The verdict alone can't
 * express that (a pre-link account can still read `spotify-disconnected`), so
 * linkedSpotifyId is part of the rule; the sync control keeps a CTA of its own
 * for that case (see useDashboardSync's `spotify-reconnect-required`). */
export function showsReconnectBanner(
	verdict: ConnectionVerdict,
	linkedSpotifyId: string | null,
): verdict is ActionableConnectionVerdict {
	return (
		linkedSpotifyId !== null &&
		(verdict.kind === "mismatch" ||
			verdict.kind === "unpaired" ||
			verdict.kind === "spotify-disconnected" ||
			verdict.kind === "unverifiable")
	);
}

export function ExtensionAccountBanner({
	verdict,
	linkedSpotifyId,
	accountDisplayName,
}: ExtensionAccountBannerProps) {
	const queryClient = useQueryClient();
	const [repairing, setRepairing] = useState(false);

	if (!showsReconnectBanner(verdict, linkedSpotifyId)) return null;

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
