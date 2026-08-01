/**
 * CreateBar — the sticky create footer for the playlist creation flow.
 *
 * Fully presentational for the ready/submitting states: submitting and
 * payload assembly are owned by usePublishPlaylist up in StudioScreen. A
 * blocked gate state, though, replaces the CTA outright with the matching
 * recovery prompt (ExtensionUnavailablePrompt / ReconnectPrompt /
 * AccountMismatchPrompt) — the same self-contained prompts the dashboard's
 * reconnect banner is built from — so a missing extension, an expired
 * Spotify session, or a wrong-account extension gets real recovery guidance
 * (install link + Firefox reload hint, or a correctly-verdicted
 * repairConnection call) instead of a dead-end generic "Connect" button.
 * Each prompt owns its own repairConnection call, so CreateBar itself never
 * has to know which verdict a given gate state needs.
 */

import type { SongVM } from "@/lib/domains/playlists/types";
import { fonts } from "@/lib/theme/fonts";
import type { SpotifyGateStatus } from "../useSpotifyGate";
import { AccountMismatchPrompt } from "./AccountMismatchPrompt";
import { ExtensionUnavailablePrompt } from "./ExtensionUnavailablePrompt";
import { ReconnectPrompt } from "./ReconnectPrompt";

async function noopRecheck() {}

export interface CreateBarProps {
	name: string;
	songs: SongVM[];
	isPreviewStale: boolean;
	isResolvingArtists: boolean;
	isArtistResolutionError: boolean;
	isSubmitting: boolean;
	/** A discriminated union (see useSpotifyGate) — `mismatchProfile` only
	 * exists on the `"account-mismatch"` variant, so it's structurally
	 * impossible to be in that state without a profile to render. */
	gate: SpotifyGateStatus;
	/** account.display_name — sharpens AccountMismatchPrompt's copy from "the
	 * wrong account" to "not <name>". */
	accountDisplayName?: string | null;
	onSubmit: () => void;
	onRetryArtistResolution?: () => void;
	/** Re-runs the gate detection; wired to ExtensionUnavailablePrompt's
	 * "Check again". */
	onRecheck?: () => Promise<void>;
}

export function CreateBar({
	name,
	songs,
	isPreviewStale,
	isResolvingArtists,
	isArtistResolutionError,
	isSubmitting,
	gate,
	accountDisplayName = null,
	onSubmit,
	onRetryArtistResolution,
	onRecheck = noopRecheck,
}: CreateBarProps) {
	const trimmedName = name.trim();
	const isGateChecking = gate.gateState === "checking";
	const canSubmit =
		songs.length > 0 &&
		trimmedName.length > 0 &&
		!isSubmitting &&
		!isPreviewStale &&
		!isResolvingArtists &&
		!isArtistResolutionError &&
		!isGateChecking;

	const songCount = songs.length;

	if (isArtistResolutionError) {
		return (
			<div
				className="flex items-center justify-between gap-4 px-5 py-3.5"
				style={{ borderLeft: "2px solid var(--t-primary)" }}
			>
				<span
					className="theme-text-muted text-xs"
					style={{ fontFamily: fonts.body }}
					aria-live="polite"
				>
					Could not load artist songs
				</span>
				{onRetryArtistResolution && (
					<button
						type="button"
						onClick={onRetryArtistResolution}
						className="hover-border-brighten focus-edge inline-flex cursor-pointer items-center whitespace-nowrap rounded-full px-3 py-1.5 text-[11px] tracking-widest uppercase active:scale-[0.98]"
						style={{ fontFamily: fonts.body }}
					>
						Retry
					</button>
				)}
			</div>
		);
	}

	// A blocked gate state replaces the CTA outright (never just disables it) —
	// each prompt below owns the repairConnection call its own verdict needs
	// (invariant 2: a mismatch must never silently re-pair while the wrong
	// Spotify identity is active).
	if (gate.gateState === "extension-unavailable") {
		return <ExtensionUnavailablePrompt onRecheck={onRecheck} />;
	}
	if (gate.gateState === "reconnect-required") {
		return <ReconnectPrompt />;
	}
	if (gate.gateState === "account-mismatch") {
		// SpotifyGateStatus ties mismatchProfile to this arm, so a real
		// TypeScript caller can't construct "account-mismatch" without one —
		// gate.mismatchProfile below is never null. This runtime guard is
		// defense-in-depth only, against a caller that bypasses the type
		// system (e.g. a stale/corrupted prop). It must stay BLOCKING and must
		// NEVER fall through to ReconnectPrompt: that prompt repairs with the
		// spotify-disconnected verdict, which pairExtension()s — exactly the
		// bug invariant 2 forbids while the wrong Spotify identity is active.
		if (!gate.mismatchProfile) {
			return (
				<div
					className="flex items-center justify-between gap-4 px-5 py-3.5"
					style={{ borderLeft: "2px solid var(--t-primary)" }}
				>
					<span
						className="theme-text-muted text-xs"
						style={{ fontFamily: fonts.body }}
						aria-live="polite"
					>
						Spotify account needs to be reverified
					</span>
					<button
						type="button"
						onClick={() => void onRecheck()}
						className="hover-border-brighten focus-edge inline-flex cursor-pointer items-center whitespace-nowrap rounded-full px-3 py-1.5 text-[11px] tracking-widest uppercase active:scale-[0.98]"
						style={{ fontFamily: fonts.body }}
					>
						Check again
					</button>
				</div>
			);
		}
		return (
			<AccountMismatchPrompt
				extensionProfile={gate.mismatchProfile}
				accountDisplayName={accountDisplayName}
			/>
		);
	}

	const hint = isGateChecking
		? "Checking connection…"
		: trimmedName.length === 0
			? "Name your playlist to create"
			: isPreviewStale || isResolvingArtists
				? "Updating…"
				: isSubmitting
					? "Creating on Spotify…"
					: songCount === 0
						? "Add songs to create"
						: null;

	return (
		<div
			className="flex items-center gap-3 px-4 py-2.5"
			style={{ fontFamily: fonts.body }}
		>
			<div className="min-w-0 flex-1">
				{hint && (
					<span
						className="theme-text-muted text-[10px] shrink-0"
						aria-live="polite"
					>
						{hint}
					</span>
				)}
			</div>

			<button
				type="button"
				disabled={!canSubmit}
				aria-busy={isSubmitting}
				aria-label={
					isSubmitting
						? "Creating…"
						: songCount > 0
							? `Create playlist with ${songCount} ${songCount === 1 ? "song" : "songs"}`
							: "Create playlist"
				}
				onClick={onSubmit}
				// The fill is --t-primary, so the edge takes the on-primary ink instead.
				className="shrink-0 text-[11px] tracking-[0.1em] uppercase cursor-pointer transition-[background-color,opacity,transform] duration-150 active:scale-[0.98] disabled:opacity-40 disabled:cursor-default focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_1.5px_var(--t-text-on-primary)]"
				style={{
					padding: "6px 16px",
					borderRadius: 10,
					// @ts-expect-error -- corner-shape not yet in CSS typings
					cornerShape: "squircle",
					border: "1px solid transparent",
					background: "var(--t-primary)",
					color: "var(--t-text-on-primary)",
					fontFamily: fonts.body,
					fontWeight: 500,
				}}
			>
				{isSubmitting ? "Creating…" : "Create"}
			</button>
		</div>
	);
}
