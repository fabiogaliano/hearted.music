import type { Story } from "@ladle/react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
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
import { AdvancedFiltersAssembly } from "./match-filters/AdvancedFiltersAssembly";
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
 * Harness for CMHF-06 drawer-width compositions. Passes AdvancedFiltersAssembly
 * into SpotlightPanel's advancedFiltersSlot prop, which threads through to
 * WritingSurface's advancedFilters slot in edit mode.
 */
function WithFiltersHarness({
	playlist,
	tracks = [],
	initialFilters,
	options,
	optionsState,
}: {
	playlist: PlaylistSummary;
	tracks?: PlaylistTrackVM[];
	initialFilters: PlaylistMatchFiltersV1;
	options: typeof MOCK_FILTER_OPTIONS;
	optionsState: "ready" | "loading" | "error";
}) {
	const [open, setOpen] = useState(true);
	const [isTarget, setIsTarget] = useState(playlist.isTarget);
	const [filters, setFilters] =
		useState<PlaylistMatchFiltersV1>(initialFilters);

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
				advancedFiltersSlot={
					<AdvancedFiltersAssembly
						filters={filters}
						onFiltersChange={setFilters}
						options={options}
						optionsState={optionsState}
					/>
				}
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
		initialFilters={{ version: 1 }}
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
		initialFilters={FILTERS_MULTI_CHIP}
		options={MOCK_FILTER_OPTIONS}
		optionsState="ready"
	/>
);
DrawerMultipleChips.meta = {
	description:
		"Real drawer width. Multiple active chips (3 languages + release year + vocals). Trigger shows count badge of 5.",
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
		initialFilters={{ version: 1 }}
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
		initialFilters={FILTERS_VOCALS_DETECTED}
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
		initialFilters={FILTERS_MULTI_CHIP}
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
		initialFilters={FILTERS_MULTI_CHIP}
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
		initialFilters={FILTERS_DENSE_LANGUAGES}
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
		initialFilters={FILTERS_MULTI_CHIP}
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
		initialFilters={FILTERS_MULTI_CHIP}
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
		initialFilters={FILTERS_SPARSE_BOUNDS}
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
		initialFilters={FILTERS_MULTI_CHIP}
		options={MOCK_FILTER_OPTIONS}
		optionsState="ready"
	/>
);
DrawerWithIntentAndGenres.meta = {
	description:
		"Real drawer width. Full composition: intent text + 3 genre pills + multiple active filter chips. Verifies the three areas (intent, genres, advanced filters) stack cleanly at real drawer width.",
};
