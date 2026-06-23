/**
 * CreateBar — the sticky footer action bar for the playlist creation flow.
 *
 * Houses:
 *  - A playlist name input (labelled, trimmed, max 100 chars).
 *  - The primary "Create playlist" CTA with a live song count badge.
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
 * inline affordance instead of a broken submit.
 */

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import type { CreatePlaylistFromDraftResult } from "@/lib/extension/create-playlist-from-draft";
import { createPlaylistFromDraft } from "@/lib/extension/create-playlist-from-draft";
import { cn } from "@/lib/shared/utils/utils";
import { fonts } from "@/lib/theme/fonts";
import { ExtensionUnavailablePrompt } from "./ExtensionUnavailablePrompt";
import { ReconnectPrompt } from "./ReconnectPrompt";

const MAX_NAME_LENGTH = 100;
const DEFAULT_NAME = "New playlist";

type SpotifyGateState =
	| "checking"
	| "ok"
	| "extension-unavailable"
	| "reconnect-required";

export interface CreateBarProps {
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
	/** Gate state computed by the parent — avoids re-checking on every render. */
	gateState: SpotifyGateState;
	/**
	 * Called with the trimmed playlist name just before the orchestrator runs.
	 * Lets the parent capture the name for the success state before this bar
	 * unmounts on a successful create.
	 */
	onNameCommit: (name: string) => void;
	/** Called with the discriminated result from the orchestrator. */
	onResult: (result: CreatePlaylistFromDraftResult) => void;
}

export function CreateBar({
	songIds,
	genrePills,
	matchFilters,
	intentApplied,
	intent,
	gateState,
	onNameCommit,
	onResult,
}: CreateBarProps) {
	const [name, setName] = useState(DEFAULT_NAME);
	const [isSubmitting, setIsSubmitting] = useState(false);

	const trimmedName = name.trim();
	const canSubmit =
		songIds.length > 0 && trimmedName.length > 0 && !isSubmitting;

	async function handleSubmit() {
		if (!canSubmit) return;

		onNameCommit(trimmedName);
		setIsSubmitting(true);
		try {
			const result = await createPlaylistFromDraft({
				name: trimmedName,
				songIds,
				genrePills,
				matchFilters,
				intentApplied,
				intent: intentApplied && intent ? intent : null,
			});

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
		return <ExtensionUnavailablePrompt />;
	}
	if (gateState === "reconnect-required") {
		return <ReconnectPrompt entityKey="create-bar" />;
	}

	const songCount = songIds.length;
	const ctaLabel =
		songCount === 0
			? "Create playlist"
			: `Create playlist · ${songCount} ${songCount === 1 ? "song" : "songs"}`;

	return (
		<div className={cn("flex items-center gap-4 px-6 py-4")}>
			{/* Name field — label is visually hidden but always in the DOM */}
			<label
				htmlFor="playlist-name"
				className="sr-only"
				style={{ fontFamily: fonts.body }}
			>
				Playlist name
			</label>
			<input
				id="playlist-name"
				type="text"
				value={name}
				onChange={(e) => setName(e.target.value.slice(0, MAX_NAME_LENGTH))}
				maxLength={MAX_NAME_LENGTH}
				disabled={isSubmitting}
				placeholder="Playlist name"
				className={cn(
					"theme-text theme-border-color min-w-0 flex-1 border-b bg-transparent pb-0.5 text-sm outline-none",
					"placeholder:theme-text-muted",
					"focus-visible:outline-none",
					"disabled:opacity-40",
					"transition-[border-color,opacity] duration-150",
					"focus:[border-color:var(--t-primary)]",
				)}
				style={{ fontFamily: fonts.body }}
				aria-describedby={
					trimmedName.length === 0 ? "playlist-name-error" : undefined
				}
			/>
			{trimmedName.length === 0 && (
				<span id="playlist-name-error" className="sr-only">
					Playlist name is required.
				</span>
			)}

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
