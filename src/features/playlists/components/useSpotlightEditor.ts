import { useEffect, useRef, useState } from "react";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import type { SavePlaylistMatchConfigResult } from "@/lib/server/playlists.functions";
import type { PlaylistSummary } from "./types";
import { useVocalsAutoFill } from "./useVocalsAutoFill";

interface UseSpotlightEditorArgs {
	playlist: PlaylistSummary | null;
	onSave: (
		id: string,
		intent: string | null,
		genres: string[],
		matchFilters: PlaylistMatchFiltersV1,
	) => Promise<SavePlaylistMatchConfigResult>;
	/** Guided onboarding mode — suppresses auto-fill and the production-only slots. */
	guidedIntent: boolean;
	/** Drop straight into the editor when a flagged-but-undescribed playlist opens. */
	autoEditOnAdd: boolean;
}

/**
 * Owns the Spotlight panel's writing-surface draft state: the three saved fields
 * (description / genres / matchFilters), their drafts, the edit/save flags, and
 * the effects that reseed on a playlist switch, settle the matching band, and
 * auto-open the editor during onboarding. Lifted out of SpotlightPanel so the
 * panel reads as layout + wiring rather than a wall of state machinery.
 */
export function useSpotlightEditor({
	playlist,
	onSave,
	guidedIntent,
	autoEditOnAdd,
}: UseSpotlightEditorArgs) {
	const [description, setDescription] = useState<string | null>(
		playlist?.intent ?? null,
	);
	const [genres, setGenres] = useState<string[]>(playlist?.genres ?? []);
	const [matchFilters, setMatchFilters] = useState<PlaylistMatchFiltersV1>(
		playlist?.matchFilters ?? { version: 1 },
	);
	const [isEditing, setIsEditing] = useState(false);
	const [isSaving, setIsSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [draftDescription, setDraftDescription] = useState("");
	const [draftGenres, setDraftGenres] = useState<string[]>([]);
	const [draftMatchFilters, setDraftMatchFilters] =
		useState<PlaylistMatchFiltersV1>({ version: 1 });

	// True once the matching band has finished opening. While open we drop the
	// band's overflow clip so the editor's downward popovers (genre search, info
	// tips) can spill past the band into the track-list area instead of being
	// sliced at the boundary. Re-clipped the moment it collapses so a closed band
	// never leaks its content.
	const [bandSettled, setBandSettled] = useState(playlist?.isTarget ?? false);

	// The saved intent text at the moment the editor was most recently opened.
	// Passed to useVocalsAutoFill so it can pre-seed the dismissal set and
	// prevent auto-fill from firing on unchanged saved text when the editor reopens.
	const autoFillInitialTextRef = useRef<string>("");

	// Identity of the playlist currently on screen, kept fresh every render. An
	// in-flight save captures the id it is saving; comparing against this ref when
	// the RPC resolves lets a stale save bail out instead of reconciling playlist
	// A's server result into a panel that has since switched to playlist B.
	const currentPlaylistIdRef = useRef<string | null>(playlist?.id ?? null);
	currentPlaylistIdRef.current = playlist?.id ?? null;

	// Reseed all three saved fields when a different playlist opens. Also resets
	// transient edit/save state so a new panel starts clean.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reseed only on identity change
	useEffect(() => {
		setDescription(playlist?.intent ?? null);
		setGenres(playlist?.genres ?? []);
		setMatchFilters(playlist?.matchFilters ?? { version: 1 });
		setIsEditing(false);
		setIsSaving(false);
		setSaveError(null);
	}, [playlist?.id]);

	// Settle the band via a timeout rather than transitionend so reduced-motion —
	// where the grid-rows transition is suppressed and never fires an end event —
	// still un-clips. ~420ms matches the 400ms open animation; collapsing re-clips
	// synchronously so the closing band stays masked.
	useEffect(() => {
		const target = playlist?.isTarget ?? false;
		if (!target) {
			setBandSettled(false);
			return;
		}
		const id = window.setTimeout(() => setBandSettled(true), 420);
		return () => window.clearTimeout(id);
	}, [playlist?.isTarget]);

	useVocalsAutoFill({
		isEditing,
		lockManualEntry: guidedIntent,
		draftDescription,
		draftMatchFilters,
		setDraftMatchFilters,
		initialText: autoFillInitialTextRef.current,
		sessionKey: playlist?.id ?? null,
	});

	const openEditor = () => {
		const initialText = description ?? "";
		// Record the text the session starts from so the auto-fill hook can
		// pre-seed it as dismissed — unchanged saved intent must not auto-fill.
		autoFillInitialTextRef.current = initialText;
		setDraftDescription(initialText);
		setDraftGenres(genres);
		setDraftMatchFilters(matchFilters);
		setIsEditing(true);
	};

	// Walkthrough: when the guided panel shows a matching playlist with no intent yet,
	// drop straight into the editor (textarea + example picker) so "add" flows into
	// "write intent" without a tap — and a refresh that reopened a flagged-but-
	// undescribed playlist lands there too, instead of the collapsed Edit affordance.
	// A described playlist (or any playlist once the cycle releases, where
	// autoEditOnAdd is off) stays collapsed.
	//
	// Seeds are read straight from the `playlist` prop, not from the committed
	// description/genres/matchFilters state: when this fires on an identity change,
	// the reseed effect above has only *queued* the new playlist's values, so the
	// state copies still hold the previous playlist's data this flush. The prop is
	// already the new playlist, so a direct B→C switch can't seed C with B's intent.
	// biome-ignore lint/correctness/useExhaustiveDependencies: genres/matchFilters are read fresh from the prop, intentionally excluded so a background refetch can't reopen a mid-edit panel
	useEffect(() => {
		const described = !!playlist?.intent && playlist.intent.trim() !== "";
		if (!autoEditOnAdd || !playlist?.isTarget || described) return;
		const initialText = playlist.intent ?? "";
		autoFillInitialTextRef.current = initialText;
		setDraftDescription(initialText);
		setDraftGenres(playlist.genres ?? []);
		setDraftMatchFilters(playlist.matchFilters ?? { version: 1 });
		setIsEditing(true);
	}, [playlist?.id, playlist?.isTarget, playlist?.intent, autoEditOnAdd]);

	// Picking a ready-made example seeds the draft from it and jumps straight into
	// editing — bypassing openEditor's reseed-from-saved, since the point is to
	// start from the example rather than the current intent. Filters carry over
	// from the saved state since examples don't touch filter state.
	const pickExample = (
		nextDescription: string,
		nextGenres: readonly string[],
	) => {
		// Guided mode — auto-fill is suppressed (lockManualEntry), but still
		// seed the ref so the hook initialText is consistent if mode ever changes.
		autoFillInitialTextRef.current = nextDescription;
		setDraftDescription(nextDescription);
		setDraftGenres([...nextGenres]);
		setDraftMatchFilters(matchFilters);
		setIsEditing(true);
	};

	const save = async () => {
		if (!playlist) return;
		const savedPlaylistId = playlist.id;
		// Clear any previous save error at the start of a new attempt.
		setSaveError(null);
		setIsSaving(true);
		try {
			const normalized = await onSave(
				savedPlaylistId,
				draftDescription.trim() || null,
				draftGenres,
				draftMatchFilters,
			);
			// Ignore a resolution that lands after the user switched/closed onto a
			// different playlist — otherwise A's server result would reconcile into
			// whichever playlist the panel shows now.
			if (currentPlaylistIdRef.current !== savedPlaylistId) return;
			// Reconcile local saved state from the server's normalized response so
			// collapsed display reflects server normalization (trimmed intent,
			// sanitized genres, normalized filters) rather than raw draft values.
			setDescription(normalized.matchIntent);
			setGenres(normalized.genrePills);
			setMatchFilters(normalized.matchFilters);
			setIsEditing(false);
		} catch {
			// Same staleness guard for the failure path: don't surface A's error on
			// B's panel.
			if (currentPlaylistIdRef.current !== savedPlaylistId) return;
			setSaveError("Couldn't save changes. Try again.");
		} finally {
			// Leave the new playlist's saving flag alone if we've since switched —
			// the reseed effect already reset it for that playlist.
			if (currentPlaylistIdRef.current === savedPlaylistId) setIsSaving(false);
		}
	};

	// Cancel reverts the draft to saved state and clears the inline save error.
	// openEditor also reseeds on the next open, but resetting here keeps draft
	// state from lingering dirty while collapsed.
	const cancel = () => {
		setDraftDescription(description ?? "");
		setDraftGenres(genres);
		setDraftMatchFilters(matchFilters);
		setIsEditing(false);
		setSaveError(null);
	};

	return {
		description,
		genres,
		matchFilters,
		isEditing,
		isSaving,
		saveError,
		draftDescription,
		draftGenres,
		draftMatchFilters,
		bandSettled,
		setDraftDescription,
		setDraftGenres,
		setDraftMatchFilters,
		openEditor,
		pickExample,
		save,
		cancel,
	};
}
