import type { Story } from "@ladle/react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import type { SavePlaylistMatchConfigResult } from "@/lib/server/playlists.functions";
import {
	FILTERS_DENSE_LANGUAGES,
	FILTERS_MULTI_CHIP,
	FILTERS_SPARSE_BOUNDS,
	FILTERS_VOCALS_DETECTED,
	MOCK_SPARSE_OPTIONS,
	samplePlaylists,
	sampleTracks,
	TOP_GENRES,
} from "./fixtures";
import { MOCK_FILTER_OPTIONS } from "./match-filters/mock-filter-options";
import { SpotlightPanel as Panel } from "./SpotlightPanel";
import type { PlaylistSummary, PlaylistTrackVM } from "./types";

/**
 * The whole Spotlight detail panel. Opens by default so the composition is
 * visible; close it (scrim, ✕, or Esc) and reopen via the button. The writing
 * surface is fully live — Edit the intent + genres, Save/Cancel — and the
 * target toggle flips the hero kicker. Switch the `playlist` control to compare
 * a full panel, a long name with a track remainder, and a fully empty playlist.
 */
export default { title: "Playlists/Explorations/Composable" };

const byId = (id: string): PlaylistSummary =>
	samplePlaylists.find((p) => p.id === id) ?? samplePlaylists[0];

function Harness({
	playlist,
	tracks = [],
}: {
	playlist: PlaylistSummary;
	tracks?: PlaylistTrackVM[];
}) {
	const [open, setOpen] = useState(true);
	const [isTarget, setIsTarget] = useState(playlist.isTarget);
	return (
		<div className="theme-bg relative min-h-screen overflow-hidden p-10">
			<Button onClick={() => setOpen(true)}>Open panel</Button>
			<Panel
				playlist={{ ...playlist, isTarget }}
				tracks={tracks}
				open={open}
				onClose={() => setOpen(false)}
				onToggleTarget={() => setIsTarget((t) => !t)}
				topGenres={TOP_GENRES}
			/>
		</div>
	);
}

export const SpotlightPanel: Story<{ playlist: string }> = ({ playlist }) => (
	<Harness
		key={playlist}
		playlist={byId(playlist)}
		tracks={sampleTracks[playlist] ?? []}
	/>
);
SpotlightPanel.args = { playlist: "mce" };
SpotlightPanel.argTypes = {
	playlist: {
		options: ["mce", "dubolt", "souvenir"],
		control: { type: "select" },
	},
};
SpotlightPanel.meta = {
	description:
		"mce = the full panel (intent, genres, tracks) · dubolt = a long name that tiers down with a '+ N more' tail · souvenir = empty (no intent/genres/tracks).",
};

/**
 * Harness for CMHF-06/CMHF-13 drawer-width compositions.
 * SpotlightPanel now owns matchFilters draft state internally; callers supply
 * matchFilterOptions + matchFilterOptionsState (the CMHF-14 seam).
 */
function WithFiltersHarness({
	playlist,
	tracks = [],
	options,
	optionsState,
}: {
	playlist: PlaylistSummary;
	tracks?: PlaylistTrackVM[];
	options: typeof MOCK_FILTER_OPTIONS;
	optionsState: "ready" | "loading" | "error";
}) {
	const [open, setOpen] = useState(true);
	const [isTarget, setIsTarget] = useState(playlist.isTarget);

	return (
		<div className="theme-bg relative min-h-screen overflow-hidden p-10">
			<Button onClick={() => setOpen(true)}>Open panel</Button>
			<Panel
				playlist={{ ...playlist, isTarget }}
				tracks={tracks}
				open={open}
				onClose={() => setOpen(false)}
				onToggleTarget={() => setIsTarget((t) => !t)}
				topGenres={TOP_GENRES}
				matchFilterOptions={options}
				matchFilterOptionsState={optionsState}
			/>
		</div>
	);
}

/**
 * CMHF-06 required state: no filters / collapsed advanced area inside real drawer.
 */
export const DrawerNoFilters: Story = () => (
	<WithFiltersHarness
		playlist={byId("mce")}
		tracks={sampleTracks.mce ?? []}
		options={MOCK_FILTER_OPTIONS}
		optionsState="ready"
	/>
);
DrawerNoFilters.meta = {
	description:
		"Real drawer width (~520–760px). No active filters — trigger collapsed. Enter edit mode to interact with the advanced filters area.",
};

/**
 * CMHF-06 required state: multiple active compact chips inside real drawer.
 */
export const DrawerMultipleChips: Story = () => (
	<WithFiltersHarness
		playlist={{ ...byId("mce"), matchFilters: FILTERS_MULTI_CHIP }}
		tracks={sampleTracks.mce ?? []}
		options={MOCK_FILTER_OPTIONS}
		optionsState="ready"
	/>
);
DrawerMultipleChips.meta = {
	description:
		"Real drawer width. Multiple active chips (3 languages + release year + vocals). Trigger shows count badge of 5. Chips visible in collapsed state (display-only); edit mode shows remove actions.",
};

/**
 * CMHF-06 required state: expanded advanced filters with all controls in drawer.
 */
export const DrawerExpandedAllControls: Story<{
	optionsState: "ready" | "loading" | "error";
}> = ({ optionsState }) => (
	<WithFiltersHarness
		key={optionsState}
		playlist={byId("mce")}
		tracks={sampleTracks.mce ?? []}
		options={MOCK_FILTER_OPTIONS}
		optionsState={optionsState}
	/>
);
DrawerExpandedAllControls.args = { optionsState: "ready" };
DrawerExpandedAllControls.argTypes = {
	optionsState: {
		options: ["ready", "loading", "error"],
		control: { type: "radio" },
	},
};
DrawerExpandedAllControls.meta = {
	description:
		"Real drawer width. All controls (Language combobox, Vocals, Release year, Liked date) at natural size. Switch optionsState to loading/error to verify disabled state at real drawer width.",
};

/**
 * CMHF-06 required state: vocals detected chip (auto-open) inside real drawer.
 */
export const DrawerVocalsDetected: Story = () => (
	<WithFiltersHarness
		playlist={{
			...byId("mce"),
			intent: "looking for songs with female vocals — soft and melancholic",
			matchFilters: FILTERS_VOCALS_DETECTED,
		}}
		tracks={sampleTracks.mce ?? []}
		options={MOCK_FILTER_OPTIONS}
		optionsState="ready"
	/>
);
DrawerVocalsDetected.meta = {
	description:
		"Real drawer width. Vocals chip auto-opens the panel (vocalGender present). Simulates detector-filled state — intent text contains the phrase that would have triggered it.",
};

/**
 * CMHF-06 required state: options loading inside real drawer.
 */
export const DrawerOptionsLoading: Story = () => (
	<WithFiltersHarness
		playlist={{ ...byId("mce"), matchFilters: FILTERS_MULTI_CHIP }}
		tracks={sampleTracks.mce ?? []}
		options={MOCK_FILTER_OPTIONS}
		optionsState="loading"
	/>
);
DrawerOptionsLoading.meta = {
	description:
		"Real drawer width. Options loading — controls disabled, 'Loading filter options…' notice visible. Chip remove actions stay enabled.",
};

/**
 * CMHF-06 required state: options error inside real drawer.
 */
export const DrawerOptionsError: Story = () => (
	<WithFiltersHarness
		playlist={{ ...byId("mce"), matchFilters: FILTERS_MULTI_CHIP }}
		tracks={sampleTracks.mce ?? []}
		options={MOCK_FILTER_OPTIONS}
		optionsState="error"
	/>
);
DrawerOptionsError.meta = {
	description:
		"Real drawer width. Options error — controls disabled, 'Filter options unavailable.' notice. Chip removal still works. Intent and genres still editable.",
};

/**
 * CMHF-06 required state: dense languages (8 selected) inside real drawer.
 */
export const DrawerDenseLanguages: Story = () => (
	<WithFiltersHarness
		playlist={{ ...byId("mce"), matchFilters: FILTERS_DENSE_LANGUAGES }}
		tracks={sampleTracks.mce ?? []}
		options={MOCK_FILTER_OPTIONS}
		optionsState="ready"
	/>
);
DrawerDenseLanguages.meta = {
	description:
		"Real drawer width. Eight language chips — verifies chip-row wrapping inside the drawer, picker selected-first ordering, and count badge.",
};

/**
 * CMHF-06 required state: long playlist name inside real drawer.
 */
export const DrawerLongPlaylistName: Story = () => (
	<WithFiltersHarness
		playlist={{ ...byId("longname"), matchFilters: FILTERS_MULTI_CHIP }}
		options={MOCK_FILTER_OPTIONS}
		optionsState="ready"
	/>
);
DrawerLongPlaylistName.meta = {
	description:
		"Real drawer width. Long playlist name (California 1970s psychedelic folk). Verifies hero title wrapping does not compress the writing surface. Active filter chips from FILTERS_MULTI_CHIP.",
};

/**
 * CMHF-06 required state: narrow drawer width.
 * Use the Ladle width addon at 414px (mobile preset) to see this one.
 */
export const DrawerNarrowWidth: Story = () => (
	<WithFiltersHarness
		playlist={byId("mce")}
		tracks={sampleTracks.mce ?? []}
		options={MOCK_FILTER_OPTIONS}
		optionsState="ready"
	/>
);
DrawerNarrowWidth.meta = {
	description:
		"Set the Ladle width addon to 414px to see the panel at narrow viewport width. Verifies Language combobox, chips, and mode tabs don't overflow.",
};

/**
 * CMHF-06 required state: sparse option bounds inside real drawer.
 */
export const DrawerSparseOptions: Story = () => (
	<WithFiltersHarness
		playlist={{ ...byId("mce"), matchFilters: FILTERS_SPARSE_BOUNDS }}
		tracks={sampleTracks.mce ?? []}
		options={MOCK_SPARSE_OPTIONS}
		optionsState="ready"
	/>
);
DrawerSparseOptions.meta = {
	description:
		"Real drawer width. No release-year or liked-date bounds (min/max/oldest all null) — add/edit controls hidden. Existing chips (release year 1990–2000, liked after 2021-06-01) remain visible and removable.",
};

/**
 * CMHF-06 required state: composed with intent + genre pills inside real drawer.
 */
export const DrawerWithIntentAndGenres: Story = () => (
	<WithFiltersHarness
		playlist={{
			...byId("mce"),
			intent:
				"hazy psychedelic folk with a coastal drift — think Joni Mitchell meets Grateful Dead at dawn",
			genres: ["folk rock", "psychedelic folk", "singer-songwriter"],
			matchFilters: FILTERS_MULTI_CHIP,
		}}
		tracks={sampleTracks.mce ?? []}
		options={MOCK_FILTER_OPTIONS}
		optionsState="ready"
	/>
);
DrawerWithIntentAndGenres.meta = {
	description:
		"Real drawer width. Full composition: intent text + 3 genre pills + multiple active filter chips. Verifies the three areas (intent, genres, advanced filters) stack cleanly at real drawer width.",
};

// ---------------------------------------------------------------------------
// CMHF-15: async save success / error / pending harness stories
// ---------------------------------------------------------------------------

/**
 * Async save harness used by the CMHF-15 save stories below.
 * saveBehavior controls what happens when the user clicks Save:
 * - "success": resolves after 800 ms with normalized values (mirrors server trim).
 * - "fail": rejects after 800 ms, showing the inline error near Save.
 * - "hang": never settles — verifies the "Saving…" pending state.
 */
function AsyncSaveHarness({
	playlist,
	tracks = [],
	saveBehavior,
}: {
	playlist: PlaylistSummary;
	tracks?: PlaylistTrackVM[];
	saveBehavior: "success" | "fail" | "hang";
}) {
	const [open, setOpen] = useState(true);
	const [isTarget, setIsTarget] = useState(playlist.isTarget);

	const handleSave = (
		_id: string,
		intent: string | null,
		genres: string[],
		matchFilters: PlaylistMatchFiltersV1,
	): Promise<SavePlaylistMatchConfigResult> => {
		return new Promise((resolve, reject) => {
			if (saveBehavior === "hang") return;
			setTimeout(() => {
				if (saveBehavior === "fail") {
					reject(new Error("stubbed save failure"));
				} else {
					// Mirror server normalization: trim intent, return as-is for genres/filters.
					const trimmed = intent?.trim() ?? "";
					resolve({
						matchIntent: trimmed.length > 0 ? trimmed : null,
						genrePills: genres,
						matchFilters,
					});
				}
			}, 800);
		});
	};

	return (
		<div className="theme-bg relative min-h-screen overflow-hidden p-10">
			<Button onClick={() => setOpen(true)}>Open panel</Button>
			<Panel
				playlist={{ ...playlist, isTarget }}
				tracks={tracks}
				open={open}
				onClose={() => setOpen(false)}
				onToggleTarget={() => setIsTarget((t) => !t)}
				topGenres={TOP_GENRES}
				matchFilterOptions={MOCK_FILTER_OPTIONS}
				matchFilterOptionsState="ready"
				onSave={handleSave}
			/>
		</div>
	);
}

/**
 * CMHF-15: Save succeeds — editor closes and collapsed display shows normalized values.
 * Enter edit mode, change intent/genres/filters, click Save. After ~800 ms the panel
 * closes and the collapsed display reflects the server's normalized response.
 */
export const DrawerSaveSuccess: Story = () => (
	<AsyncSaveHarness
		playlist={byId("mce")}
		tracks={sampleTracks.mce ?? []}
		saveBehavior="success"
	/>
);
DrawerSaveSuccess.meta = {
	description:
		"CMHF-15: Save resolves after 800 ms. Editor closes on success; collapsed display shows normalized server values. Enter edit mode, change intent/genres, click Save.",
};

/**
 * CMHF-15: Save fails — editor stays open, draft preserved, inline error shown near Save.
 * Enter edit mode, click Save. After ~800 ms the inline error appears; Cancel clears it.
 */
export const DrawerSaveError: Story = () => (
	<AsyncSaveHarness
		playlist={byId("mce")}
		tracks={sampleTracks.mce ?? []}
		saveBehavior="fail"
	/>
);
DrawerSaveError.meta = {
	description:
		"CMHF-15: Save rejects after 800 ms. Inline error 'Couldn't save changes. Try again.' appears near Save. Editor stays open, draft is preserved. Cancel clears error.",
};

/**
 * CMHF-15: Save pending — Save shows "Saving…", button disabled, editor stays open.
 * Enter edit mode and click Save. The promise never settles, verifying frozen pending UI.
 */
export const DrawerSavePending: Story = () => (
	<AsyncSaveHarness
		playlist={byId("mce")}
		tracks={sampleTracks.mce ?? []}
		saveBehavior="hang"
	/>
);
DrawerSavePending.meta = {
	description:
		"CMHF-15: Save never settles. Verifies 'Saving…' button text, disabled Save and Cancel buttons, and that the editor stays open.",
};

// ---------------------------------------------------------------------------
// CMHF-17: vocals detector editor auto-fill stories
// ---------------------------------------------------------------------------

/**
 * CMHF-17: Auto-fill from intent text — type a phrase that triggers the detector.
 *
 * Enter edit mode, then type (or clear + retype) in the intent field:
 *   - "songs with female vocals" → Female chip appears after 300 ms debounce
 *   - "deep male vocals" → Male chip appears
 *   - "female and male duet" → no chip (ambiguous)
 *   - Clear the chip then keep the text unchanged → chip stays gone
 *   - Change the text → detection runs again
 *   - Reopen the editor on unchanged saved text → chip does not re-appear
 */
export const DrawerVocalsAutoFill: Story = () => (
	<WithFiltersHarness
		playlist={{
			...byId("mce"),
			intent: null,
			matchFilters: { version: 1 },
		}}
		tracks={sampleTracks.mce ?? []}
		options={MOCK_FILTER_OPTIONS}
		optionsState="ready"
	/>
);
DrawerVocalsAutoFill.meta = {
	description:
		"CMHF-17: Vocals detector auto-fill. Enter edit mode and type into the intent field. 'female vocals' fills the Female chip after 300 ms; clearing the chip prevents re-add on the same text; changing text re-enables detection; ambiguous text (both signals) does not fill.",
};

/**
 * CMHF-17: Auto-fill respects saved vocalGender — no overwrite.
 *
 * The playlist already has vocalGender: "male" saved. Even if the intent text
 * contains "female", the saved value must not be overwritten.
 */
export const DrawerVocalsAutoFillNoOverwrite: Story = () => (
	<WithFiltersHarness
		playlist={{
			...byId("mce"),
			intent: "songs with female vocals",
			matchFilters: { version: 1, vocalGender: "male" },
		}}
		tracks={sampleTracks.mce ?? []}
		options={MOCK_FILTER_OPTIONS}
		optionsState="ready"
	/>
);
DrawerVocalsAutoFillNoOverwrite.meta = {
	description:
		"CMHF-17: Saved vocalGender='male' is preserved even though the intent says 'female vocals'. Auto-fill must not overwrite an existing (saved or manual) vocalGender.",
};

/**
 * CMHF-17: No auto-fill on re-open with unchanged saved intent.
 *
 * Playlist saved with intent "songs with female vocals" and no vocalGender
 * (the user previously dismissed the chip and saved without it). Opening the
 * editor on the same text must not trigger auto-fill.
 */
export const DrawerVocalsNoReAddOnOpen: Story = () => (
	<WithFiltersHarness
		playlist={{
			...byId("mce"),
			// Saved intent that contains a female signal but no vocalGender — simulates
			// a previous session where the user dismissed the chip and saved without it.
			intent: "songs with female vocals",
			matchFilters: { version: 1 },
		}}
		tracks={sampleTracks.mce ?? []}
		options={MOCK_FILTER_OPTIONS}
		optionsState="ready"
	/>
);
DrawerVocalsNoReAddOnOpen.meta = {
	description:
		"CMHF-17: Saved intent contains 'female vocals' but no vocalGender (user previously dismissed). Opening the editor must not auto-add the chip. Only if the user edits the text will detection run again.",
};
