/**
 * AccountMismatchPrompt — inline affordance for the create touchpoint when
 * the browser extension is signed into a DIFFERENT Spotify account than the
 * one hearted has linked. Mirrors ReconnectPrompt/ExtensionUnavailablePrompt's
 * structure (same "Check again" recovery pattern) but for a verdict that
 * can't be silently repaired (invariant 2) — the user has to actually sign
 * into the right Spotify account, so the primary action opens Spotify login
 * via the same `repairConnection` primitive the dashboard's account-mismatch
 * banner uses, rather than a plain SpotifyReconnectLink anchor (which has no
 * way to express "you're connected, just as the wrong person").
 *
 * Publishing a playlist while this prompt is showing would create it on
 * Spotify under whichever account the extension's live token belongs to —
 * not the account this hearted library is linked to — so CreateBar renders
 * this INSTEAD of the create CTA for as long as the gate reports
 * "account-mismatch" (see useSpotifyGate.ts's deviation-log comment).
 */

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { repairConnection } from "@/lib/extension/connection/repair";
import type { ConnectionVerdict } from "@/lib/extension/connection/verdict";
import type { ExtensionSpotifyProfile } from "@/lib/extension/detect";
import { fonts } from "@/lib/theme/fonts";

// Same inline login URL SpotifyReconnectLink uses (dashboard's banner uses
// the accounts.spotify.com wrapper instead — see 02-repair-action.md's
// dashboard-vs-inline URL split).
const SPOTIFY_LOGIN_URL = "https://open.spotify.com/";

interface AccountMismatchPromptProps {
	/** The Spotify identity the extension is actually signed in as. */
	extensionProfile: ExtensionSpotifyProfile;
	/** Display name of the hearted account's linked Spotify identity, when
	 * known — sharpens the copy from "the wrong account" to "not X". */
	accountDisplayName: string | null;
	/** Re-runs the gate detection; resolves once the check settles. */
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
		// Reset on effect re-run so StrictMode's mount→cleanup→mount cycle
		// doesn't leave the ref permanently false.
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
		// repairConnection opens Spotify synchronously (invariant 1) — nothing
		// awaited before this call. Its returned promise can genuinely reject
		// (pairExtension() throwing, though mismatch never triggers pairing —
		// see repair.ts), so it's caught rather than left unhandled; there's no
		// extra recovery to show beyond stopping the spinner.
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
			className="flex items-center gap-4 px-6 py-5"
			role="status"
			aria-live="polite"
		>
			<p
				className="theme-text-muted text-xs text-balance"
				style={{ fontFamily: fonts.body }}
			>
				Your browser is signed in to Spotify as{" "}
				<strong className="font-medium">{extensionProfile.displayName}</strong>
				{accountDisplayName ? (
					<>
						, but this library belongs to{" "}
						<strong className="font-medium">{accountDisplayName}</strong>
					</>
				) : (
					", which isn't the account this library was built from"
				)}
				.
			</p>
			<button
				type="button"
				onClick={handleSwitch}
				disabled={isSwitching}
				className="hover-border-brighten inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs tracking-widest uppercase active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
				style={{ fontFamily: fonts.body }}
			>
				{isSwitching ? "Switching…" : "Switch Spotify account"}
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
