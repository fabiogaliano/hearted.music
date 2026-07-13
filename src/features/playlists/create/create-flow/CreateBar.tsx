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
 * useCreatePlaylistFlow up in CreatePlaylistScreen. This bar just renders
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
 * reconnect or extension is needed, the CTA is replaced by the appropriate
 * inline affordance instead of a broken submit. Those affordances get the
 * gate's recheck so the user can recover in place without a page reload.
 */

import { Button } from "@/components/ui/Button";
import { fonts } from "@/lib/theme/fonts";
import type { SpotifyGateState } from "../useSpotifyGate";
import { ExtensionUnavailablePrompt } from "./ExtensionUnavailablePrompt";
import { ReconnectPrompt } from "./ReconnectPrompt";

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
	/** Re-runs the gate detection; wired to the gate-failure affordances. */
	recheck: () => Promise<void>;
	/** Called when the user submits — the screen assembles the payload. */
	onSubmit: () => void;
}

export function CreateBar({
	name,
	songIds,
	isPreviewStale,
	isResolvingArtists,
	isArtistResolutionError,
	isSubmitting,
	gateState,
	recheck,
	onSubmit,
}: CreateBarProps) {
	const trimmedName = name.trim();
	const canSubmit =
		songIds.length > 0 &&
		trimmedName.length > 0 &&
		!isSubmitting &&
		!isPreviewStale &&
		!isResolvingArtists &&
		!isArtistResolutionError;

	// Show the relevant inline affordance for gate failures instead of the CTA.
	if (gateState === "extension-unavailable") {
		return <ExtensionUnavailablePrompt onRecheck={recheck} />;
	}
	if (gateState === "reconnect-required") {
		return <ReconnectPrompt onRecheck={recheck} />;
	}

	const songCount = songIds.length;
	const ctaLabel =
		songCount === 0
			? "Create playlist"
			: `Create playlist · ${songCount} ${songCount === 1 ? "song" : "songs"}`;

	// Explains a disabled CTA now that the name field lives in the page title.
	// The artist-resolution error takes precedence over the generic "updating"
	// hint: it's the one case where waiting doesn't help — the user needs to
	// go retry in the ArtistConfig panel instead.
	const hint =
		trimmedName.length === 0
			? "Name your playlist above to create"
			: isArtistResolutionError
				? "Couldn't load one or more artists — retry in the Artists panel"
				: isPreviewStale || isResolvingArtists
					? "Updating preview…"
					: null;

	return (
		<div className="flex items-center justify-between gap-4 px-6 py-4">
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
				{ctaLabel}
			</Button>
		</div>
	);
}
