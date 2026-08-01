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

/**
 * Songs whose durationMs never arrived (not yet enriched) would otherwise drag
 * the total down, so they're valued at the average of the ones we do know —
 * the label reads "~" precisely because of this.
 */
function estimateMinutes(songs: SongVM[]): number {
	const known = songs.filter((s) => s.durationMs !== null);
	if (known.length === 0) return 0;
	const knownMs = known.reduce((sum, s) => sum + (s.durationMs ?? 0), 0);
	const totalMs = (knownMs / known.length) * songs.length;
	return Math.round(totalMs / 60_000);
}

function formatDuration(minutes: number): string {
	if (minutes < 60) return `~${minutes} min`;
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	return rest === 0 ? `~${hours} hr` : `~${hours} hr ${rest} min`;
}

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
	const songCount = songs.length;

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
						className="chip-raised chip-raised-hover squircle focus-edge inline-flex cursor-pointer items-center whitespace-nowrap rounded-full px-3 py-1.5 text-[11px] tracking-widest uppercase active:scale-[0.98]"
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
						className="chip-raised chip-raised-hover squircle focus-edge inline-flex cursor-pointer items-center whitespace-nowrap rounded-full px-3 py-1.5 text-[11px] tracking-widest uppercase active:scale-[0.98]"
						style={{ fontFamily: fonts.body }}
					>
						Retry
					</button>
				)}
			</div>
		);
	}

	let submitBlocker: string | null = null;
	if (isGateChecking) {
		submitBlocker = "Checking connection…";
	} else if (trimmedName.length === 0) {
		submitBlocker = "Name your playlist first";
	} else if (isPreviewStale || isResolvingArtists) {
		submitBlocker = "Updating…";
	} else if (isSubmitting) {
		submitBlocker = "Creating on Spotify…";
	} else if (songCount === 0) {
		submitBlocker = "Add songs to create";
	}
	const canSubmit = submitBlocker === null;

	let createButtonLabel = "Create playlist";
	if (isSubmitting) {
		createButtonLabel = "Creating…";
	} else if (songCount > 0) {
		createButtonLabel = `Create playlist with ${songCount} ${songCount === 1 ? "song" : "songs"}`;
	}

	return (
		<div
			className="flex items-center gap-3 px-4 py-2.5"
			style={{ fontFamily: fonts.body }}
		>
			<div className="min-w-0 flex-1">
				{submitBlocker ? (
					<span
						className="theme-text-muted shrink-0 text-xs"
						aria-live="polite"
					>
						{submitBlocker}
					</span>
				) : (
					<div className="flex min-w-0 items-baseline gap-2 text-xs">
						<span className="min-w-0 truncate" title={trimmedName}>
							{trimmedName}
						</span>
						<span className="theme-text-muted shrink-0 opacity-50">·</span>
						<span className="theme-text-muted shrink-0 tabular-nums">
							{songCount} {songCount === 1 ? "track" : "tracks"}
						</span>
						<span className="theme-text-muted shrink-0 opacity-50">·</span>
						<span className="theme-text-muted shrink-0 tabular-nums">
							{formatDuration(estimateMinutes(songs))}
						</span>
					</div>
				)}
			</div>

			<button
				type="button"
				disabled={!canSubmit}
				aria-busy={isSubmitting}
				aria-label={createButtonLabel}
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
