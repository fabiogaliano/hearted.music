import { useEffect, useRef } from "react";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import { detectVocalGender } from "@/lib/domains/taste/match-filters/vocals-detector";

/**
 * Wires the vocals detector into the editor draft (CMHF-17).
 *
 * Precedence rules (decisions §9):
 *   1. Never overwrite an existing draftMatchFilters.vocalGender (manual-set or
 *      saved). Auto-fill only when vocalGender is absent from the draft.
 *   2. If the user clears the auto-filled chip while the draft text is unchanged,
 *      we record that exact text as "dismissed" and will not re-add for it.
 *   3. As soon as draftDescription changes the dismissal no longer applies — detection
 *      runs again. Even if the new text detects the same gender, it may fill again.
 *   4. On editor open we seed the initial text as already-dismissed so unchanged
 *      saved intent never auto-fills on a fresh open (§9 "future editor opens").
 *   5. Detection does NOT run in guided mode (lockManualEntry) — that path's intent
 *      is example-driven and the control may not be visible.
 *   6. "ambiguous" and "none" results never auto-fill.
 *
 * Dismissal state lives only in a ref — it is session-local and is never persisted.
 * It resets when the edit session changes — keyed on `sessionKey` (the playlist
 * identity) OR a changed `initialText` seed. Keying on identity, not text alone,
 * stops a dismissal in one playlist from leaking into another that happens to open
 * with the same initial intent text.
 *
 * Debounce: 300 ms. Detection is O(n·patterns) and synchronous; the debounce
 * prevents running on every keystroke and keeps the chip from flickering when the
 * user is mid-word (e.g. typing "femal" then "female").
 */
export function useVocalsAutoFill({
	isEditing,
	lockManualEntry,
	draftDescription,
	draftMatchFilters,
	setDraftMatchFilters,
	initialText,
	sessionKey,
}: {
	isEditing: boolean;
	lockManualEntry: boolean;
	draftDescription: string;
	draftMatchFilters: PlaylistMatchFiltersV1;
	setDraftMatchFilters: (next: PlaylistMatchFiltersV1) => void;
	/**
	 * The saved intent text at the moment this edit session opened. Used to
	 * pre-seed the dismissal set so reopening on unchanged intent never auto-fills.
	 */
	initialText: string;
	/**
	 * Identity of the current edit session — the open playlist's id (null when no
	 * playlist is open). Drives the dismissal reset so two playlists that share the
	 * same initial text don't share dismissals.
	 */
	sessionKey: string | null;
}): void {
	// Set of exact draft-description strings that the user has dismissed.
	// A plain Set ref — no re-render needed on mutation.
	const dismissedTexts = useRef<Set<string>>(new Set());

	// Pre-seed the initial text as dismissed so that opening the editor on
	// a playlist whose saved intent already contained a vocal signal does not
	// immediately auto-fill (§9 "future editor opens must not re-add").
	// Reset on a new edit session — keyed on sessionKey (playlist identity) OR a
	// changed initialText seed. Identity matters: without it, switching to another
	// playlist that opens with the SAME initial text would keep the first
	// playlist's dismissals and wrongly suppress auto-fill in the second.
	const prevSessionKeyRef = useRef<string | null>(sessionKey);
	const prevInitialTextRef = useRef<string>(initialText);
	if (
		prevSessionKeyRef.current !== sessionKey ||
		prevInitialTextRef.current !== initialText
	) {
		// New playlist / new session — wipe stale dismissals and seed the new one.
		dismissedTexts.current = new Set([initialText]);
		prevSessionKeyRef.current = sessionKey;
		prevInitialTextRef.current = initialText;
	} else if (dismissedTexts.current.size === 0) {
		// First mount: seed initial text as dismissed.
		dismissedTexts.current.add(initialText);
	}

	// Detect a user-initiated clear during render — the same prev-vs-current ref
	// comparison the session reset above uses, not a synchronization with an
	// external system, so it doesn't belong in an effect. When vocalGender
	// transitions from a value to undefined while draftDescription is unchanged,
	// the user tapped the X → record this exact text as dismissed.
	const prevVocalGenderRef = useRef<"female" | "male" | undefined>(
		draftMatchFilters.vocalGender,
	);
	const prevDescriptionRef = useRef<string>(draftDescription);

	const prevGender = prevVocalGenderRef.current;
	const prevDesc = prevDescriptionRef.current;
	prevVocalGenderRef.current = draftMatchFilters.vocalGender;
	prevDescriptionRef.current = draftDescription;
	if (
		prevGender !== undefined &&
		draftMatchFilters.vocalGender === undefined &&
		draftDescription === prevDesc
	) {
		dismissedTexts.current.add(draftDescription);
	}

	// Auto-fill effect — debounced, runs only in edit mode (not guided).
	useEffect(() => {
		if (!isEditing || lockManualEntry) return;

		// Do not overwrite a manually or saved-set vocalGender.
		if (draftMatchFilters.vocalGender !== undefined) return;

		// Do not fill if the user already dismissed this exact text.
		if (dismissedTexts.current.has(draftDescription)) return;

		const id = setTimeout(() => {
			// Re-check guards inside the timeout — state may have changed.
			if (dismissedTexts.current.has(draftDescription)) return;

			const result = detectVocalGender(draftDescription);
			if (result.kind !== "female" && result.kind !== "male") return;

			setDraftMatchFilters({
				...draftMatchFilters,
				vocalGender: result.kind,
			});
		}, 300);

		return () => clearTimeout(id);
		// draftMatchFilters is intentionally a dep: if something else clears
		// vocalGender (e.g. Cancel and re-open on same text) we must not re-add
		// unless text changed (which dismissedTexts guards).
	}, [
		isEditing,
		lockManualEntry,
		draftDescription,
		draftMatchFilters,
		setDraftMatchFilters,
	]);
}
