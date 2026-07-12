/**
 * CreateBar — the full-width create footer for the playlist creation flow.
 *
 * Houses the primary "Create playlist" CTA with a live song-count badge and a
 * left-aligned readiness hint. The playlist NAME lives in the page-title input
 * on the screen (not here), so this bar receives the committed name as a prop;
 * the hint explains a disabled CTA (unnamed draft or a preview still settling)
 * now that the name field it used to own has moved away.
 *
 * On submit it calls the createPlaylistFromDraft orchestrator with the full
 * draft payload and maps the discriminated result to the right UI state via
 * the onResult callback. The draft is never mutated here so it survives any
 * failure branch intact for retry.
 *
 * onNameCommit is called with the trimmed name just before the orchestrator
 * runs, so the parent can display the committed name in the success state
 * even after this bar unmounts.
 *
 * Gated by the Spotify gate state already computed by the parent screen — if
 * reconnect or extension is needed, the CTA is replaced by the appropriate
 * inline affordance instead of a broken submit. Those affordances get the
 * gate's recheck so the user can recover in place without a page reload.
 */

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import type {
	CreatePlaylistFromDraftInput,
	CreatePlaylistFromDraftResult,
} from "@/lib/extension/create-playlist-from-draft";
import { createPlaylistFromDraft } from "@/lib/extension/create-playlist-from-draft";
import { fonts } from "@/lib/theme/fonts";
import type { SpotifyGateState } from "../useSpotifyGate";
import { ExtensionUnavailablePrompt } from "./ExtensionUnavailablePrompt";
import { ReconnectPrompt } from "./ReconnectPrompt";

export interface CreateBarProps {
	/** The playlist name, owned by the screen's title input. */
	name: string;
	/** Ordered song UUIDs to include in the playlist. */
	songIds: string[];
	/** Genre pills from the current draft config. */
	genrePills: string[];
	/** Match filters from the current draft config. */
	matchFilters: PlaylistMatchFiltersV1;
	/** Whether the preview engine applied the intent phrase. */
	intentApplied: boolean;
	/** The intent phrase from the config (only sent if intentApplied). */
	intent: string | null | undefined;
	/**
	 * True while the live config is ahead of the previewed (debounced) config.
	 * Blocks Create so a submit can't persist an edited config against songs
	 * scored under the previous one.
	 */
	isPreviewStale: boolean;
	/** Gate state computed by the parent — avoids re-checking on every render. */
	gateState: SpotifyGateState;
	/** Re-runs the gate detection; wired to the gate-failure affordances. */
	recheck: () => Promise<void>;
	/**
	 * Called with the trimmed playlist name just before the orchestrator runs.
	 * Lets the parent capture the name for the success state before this bar
	 * unmounts on a successful create.
	 */
	onNameCommit: (name: string) => void;
	/**
	 * Called with the exact orchestrator input just before it runs. Lets the
	 * parent snapshot the submitted draft so a "created-unsynced" retry resumes
	 * against the same settings even if the live config is edited afterward.
	 */
	onSubmitInput?: (input: CreatePlaylistFromDraftInput) => void;
	/** Called with the discriminated result from the orchestrator. */
	onResult: (result: CreatePlaylistFromDraftResult) => void;
}

export function CreateBar({
	name,
	songIds,
	genrePills,
	matchFilters,
	intentApplied,
	intent,
	isPreviewStale,
	gateState,
	recheck,
	onNameCommit,
	onSubmitInput,
	onResult,
}: CreateBarProps) {
	const [isSubmitting, setIsSubmitting] = useState(false);

	const trimmedName = name.trim();
	const canSubmit =
		songIds.length > 0 &&
		trimmedName.length > 0 &&
		!isSubmitting &&
		!isPreviewStale;

	async function handleSubmit() {
		if (!canSubmit) return;

		onNameCommit(trimmedName);
		const submitInput: CreatePlaylistFromDraftInput = {
			name: trimmedName,
			songIds,
			genrePills,
			matchFilters,
			intentApplied,
			intent: intentApplied && intent ? intent : null,
		};
		onSubmitInput?.(submitInput);
		setIsSubmitting(true);
		try {
			const result = await createPlaylistFromDraft(submitInput);

			if (result.status === "error") {
				toast.error(result.message);
				// Re-enable the CTA so the user can retry.
				setIsSubmitting(false);
				return;
			}

			onResult(result);
			// Keep submitting=true for non-error results so the bar stays inert
			// while the parent transitions to a result state.
		} catch {
			toast.error("Something went sideways. Let's try that again.");
			setIsSubmitting(false);
		}
	}

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
	const hint =
		trimmedName.length === 0
			? "Name your playlist above to create"
			: isPreviewStale
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
				onClick={handleSubmit}
			>
				{ctaLabel}
			</Button>
		</div>
	);
}
