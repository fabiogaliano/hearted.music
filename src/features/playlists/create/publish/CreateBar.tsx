/**
 * CreateBar — the full-width create footer for the playlist creation flow.
 *
 * Houses the primary "Create playlist" CTA with a live song-count badge and a
 * left-aligned readiness hint. The playlist NAME lives in the page-title input
 * on the screen (not here), so this bar receives the committed name as a prop;
 * the hint explains a disabled CTA (unnamed draft or a preview still settling)
 * now that the name field it used to own has moved away.
 *
 * Fully presentational: submitting and payload assembly are owned by
 * usePublishPlaylist up in CreatePlaylistScreen. This bar just renders
 * readiness state and forwards a plain onSubmit — no orchestrator import.
 *
 * isResolvingArtists / isArtistResolutionError also gate the CTA: while the
 * studio's artist-song resolution is in flight (or failed), the effective
 * pinned ids don't yet reflect the selected artists, so a submit here would
 * silently create the playlist without their songs. Both conditions reuse
 * the "preview not settled" framing — the resolving case shares the
 * isPreviewStale hint, the error case gets its own, pointing at the
 * ArtistConfig panel where the actual retry affordance lives.
 *
 * Gated by the Spotify gate state already computed by the parent screen — if
 * reconnect, extension, or account-mismatch is needed, the CTA is replaced by
 * the appropriate inline affordance instead of a broken (or, for mismatch,
 * wrong-account) submit. Those affordances get the gate's recheck so the user
 * can recover in place without a page reload.
 */

import { Button } from "@/components/ui/Button";
import { fonts } from "@/lib/theme/fonts";
import type { SpotifyGateState } from "../useSpotifyGate";

export interface CreateBarProps {
	/** The playlist name, owned by the screen's title input. */
	name: string;
	/** Ordered song UUIDs to include in the playlist. */
	songIds: string[];
	/**
	 * True while the live config is ahead of the previewed (debounced) config.
	 * Blocks Create so a submit can't persist an edited config against songs
	 * scored under the previous one.
	 */
	isPreviewStale: boolean;
	/**
	 * True while the selected artists' song resolution is in flight (including
	 * background refetches). Blocks Create for the same reason as
	 * isPreviewStale: the pinned ids haven't caught up with the current artist
	 * selection yet.
	 */
	isResolvingArtists: boolean;
	/**
	 * True when the artist song resolution query failed outright. Submitting
	 * in this state would silently create the playlist with every selected
	 * artist's pool empty, so this blocks harder than isResolvingArtists and
	 * gets its own hint directing the user to the ArtistConfig retry.
	 */
	isArtistResolutionError: boolean;
	/** True while the flow's submit is in flight. */
	isSubmitting: boolean;
	/** Gate state computed by the parent — avoids re-checking on every render. */
	gateState: SpotifyGateState;
	/** Called when the user submits — the screen assembles the payload. */
	onSubmit: () => void;
	/** Retries the failed artist song resolution from the footer. */
	onRetryArtistResolution?: () => void;
}

export function CreateBar({
	name,
	songIds,
	isPreviewStale,
	isResolvingArtists,
	isArtistResolutionError,
	isSubmitting,
	gateState,
	onSubmit,
	onRetryArtistResolution,
}: CreateBarProps) {
	const trimmedName = name.trim();
	const isGateBlocked = gateState !== "ok" && gateState !== "checking";
	const isGateChecking = gateState === "checking";
	const canSubmit =
		songIds.length > 0 &&
		trimmedName.length > 0 &&
		!isSubmitting &&
		!isPreviewStale &&
		!isResolvingArtists &&
		!isArtistResolutionError &&
		!isGateChecking &&
		!isGateBlocked;

	const songCount = songIds.length;
	const ctaLabel =
		songCount === 0
			? "Create playlist"
			: `Create playlist · ${songCount} ${songCount === 1 ? "song" : "songs"}`;

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
						className="hover-border-brighten inline-flex cursor-pointer items-center whitespace-nowrap rounded-full px-3 py-1.5 text-[11px] tracking-widest uppercase active:scale-[0.98]"
						style={{ fontFamily: fonts.body }}
					>
						Retry
					</button>
				)}
			</div>
		);
	}

	const hint = isGateBlocked
		? "Connect Spotify above to create"
		: isGateChecking
			? "Checking your Spotify connection…"
			: trimmedName.length === 0
				? "Name your playlist above to create"
				: isPreviewStale || isResolvingArtists
					? "Updating preview…"
					: isSubmitting
						? "Creating on Spotify…"
						: songCount === 0
							? "Nothing selected yet"
							: "Saves to your Spotify";

	return (
		<div className="flex items-center justify-between gap-4 px-5 py-3.5">
			<span
				className="theme-text-muted text-xs"
				style={{ fontFamily: fonts.body }}
				aria-live="polite"
			>
				{hint}
			</span>
			<Button
				variant="primary"
				size="sm"
				disabled={!canSubmit}
				aria-busy={isSubmitting}
				onClick={onSubmit}
			>
				{isSubmitting ? "Creating…" : ctaLabel}
			</Button>
		</div>
	);
}
