import { type ReactNode, useRef } from "react";
import type { DescriptionExample } from "./DescriptionExamplesShuffle";
import { WritingSurfaceCollapsed } from "./WritingSurfaceCollapsed";
import { WritingSurfaceEditor } from "./WritingSurfaceEditor";
import "./playlist-ui.css";

interface WritingSurfaceProps {
	description: string | null;
	genres: string[];
	isEditing: boolean;
	draftDescription: string;
	draftGenres: string[];
	topGenres?: readonly string[];
	isSaving?: boolean;
	/** Inline save error shown near Save on failure. Null/undefined = no error displayed. */
	saveError?: string | null;
	/** Render the intent in the display serif — the brand's editorial voice. */
	intentSerif?: boolean;
	/** Names the collapsed description for a card→panel shared-element morph. */
	descriptionViewTransitionName?: string;
	/** Hide the "can't be matched yet" caution — used in the onboarding rehearsal
	 *  where canned playlists start empty and the nudge would be noise. */
	hideUnmatchableWarning?: boolean;
	/** Override the editor textarea's placeholder — the onboarding preview swaps in
	 *  a CTA. Omitted falls back to the neutral production prompt. */
	intentPlaceholder?: string;
	/** Onboarding guided mode: lock manual entry so the only way to fill the intent
	 *  is picking a ready-made example. The textarea goes read-only (no typing, no
	 *  autofocus), the genre picker is disabled, Cancel is hidden, and Save stays
	 *  disabled until a description is present. */
	lockManualEntry?: boolean;
	/** Guided mode only: the example-picker element, rendered inside the intent
	 *  field until a pick fills the draft — then it collapses out and the picked
	 *  text takes its place. Ignored unless lockManualEntry is set. */
	examplesSlot?: ReactNode;
	/** Production intent examples for the "(i)" popover beside the Matching intent
	 *  label — the shuffle-to-fill helper for users facing a blank intent. Shown
	 *  only when editing manually (suppressed in lockManualEntry/guided mode, which
	 *  has its own inline examplesSlot). Omitted hides the popover entirely. */
	intentExamples?: readonly DescriptionExample[];
	/**
	 * Advanced filters panel, rendered below the Genres area and above Save/Cancel.
	 * Optional — omitting leaves the layout unchanged and existing usages unaffected.
	 * Only rendered in edit mode where filters can be mutated.
	 */
	advancedFilters?: ReactNode;
	/**
	 * Display-only filter chips rendered in collapsed (non-editing) state under the
	 * intent/genre area. No remove affordance — editing requires entering edit mode,
	 * matching the genres interaction pattern (decisions §7 "Collapsed/non-editing state").
	 */
	collapsedFiltersSlot?: ReactNode;
	onEditDescription: () => void;
	onEditGenres: () => void;
	onDraftDescriptionChange: (value: string) => void;
	onDraftGenresChange: (next: string[]) => void;
	onSave: () => void;
	onCancel: () => void;
}

/**
 * The writing surface, presentational and frame-agnostic. Hierarchy comes from
 * type + space, not chrome (no card, no border): the intent is the primary body
 * element — larger, full ink — under a single Intent eyebrow; the genres sit just
 * below it without their own label, since chosen genres read as part of the intent.
 * Surrounding zone chrome is owned by the composing panel/hero so this stays
 * reusable across variants. Collapsed display and the edit form are split into two
 * focused subcomponents; this parent owns only the focus-target ref they share
 * across the collapse→edit transition.
 */
export function WritingSurface({
	description,
	genres,
	isEditing,
	draftDescription,
	draftGenres,
	topGenres,
	isSaving = false,
	saveError = null,
	intentSerif = false,
	descriptionViewTransitionName,
	hideUnmatchableWarning = false,
	intentPlaceholder = "What is this playlist for?",
	lockManualEntry = false,
	examplesSlot,
	intentExamples,
	advancedFilters,
	collapsedFiltersSlot,
	onEditDescription,
	onEditGenres,
	onDraftDescriptionChange,
	onDraftGenresChange,
	onSave,
	onCancel,
}: WritingSurfaceProps) {
	// Which control the editor focuses on open. A collapsed row sets this before
	// flipping into edit mode, so "Edit genres" lands in the picker rather than the
	// textarea. A ref (not state) so setting it never triggers a render.
	const focusTargetRef = useRef<"description" | "genres">("description");

	const enterDescription = () => {
		focusTargetRef.current = "description";
		onEditDescription();
	};
	const enterGenres = () => {
		focusTargetRef.current = "genres";
		onEditGenres();
	};

	if (isEditing) {
		return (
			<WritingSurfaceEditor
				draftDescription={draftDescription}
				draftGenres={draftGenres}
				topGenres={topGenres}
				isSaving={isSaving}
				saveError={saveError}
				intentSerif={intentSerif}
				intentPlaceholder={intentPlaceholder}
				lockManualEntry={lockManualEntry}
				examplesSlot={examplesSlot}
				intentExamples={intentExamples}
				advancedFilters={advancedFilters}
				focusTargetRef={focusTargetRef}
				onDraftDescriptionChange={onDraftDescriptionChange}
				onDraftGenresChange={onDraftGenresChange}
				onSave={onSave}
				onCancel={onCancel}
			/>
		);
	}

	return (
		<WritingSurfaceCollapsed
			description={description}
			genres={genres}
			intentSerif={intentSerif}
			descriptionViewTransitionName={descriptionViewTransitionName}
			hideUnmatchableWarning={hideUnmatchableWarning}
			collapsedFiltersSlot={collapsedFiltersSlot}
			onEditDescription={enterDescription}
			onEditGenres={enterGenres}
		/>
	);
}
