import type { Story } from "@ladle/react";
import { useState } from "react";
import type {
	PlaylistMatchFilterOptions,
	PlaylistMatchFiltersV1,
} from "@/lib/domains/taste/match-filters/types";
import {
	FILTERS_DENSE_LANGUAGES,
	FILTERS_MULTI_CHIP,
	FILTERS_SPARSE_BOUNDS,
	FILTERS_VOCALS_DETECTED,
	MOCK_SPARSE_OPTIONS,
	TOP_GENRES,
} from "./fixtures";
import { ActiveFilterChips } from "./match-filters/ActiveFilterChips";
import { AdvancedFiltersAssembly } from "./match-filters/AdvancedFiltersAssembly";
import { MOCK_FILTER_OPTIONS } from "./match-filters/mock-filter-options";
import { WritingSurface as Surface } from "./WritingSurface";

export default { title: "Playlists/Explorations/Components" };

const GENRE_PRESETS: Record<string, string[]> = {
	none: [],
	"two genres": ["indie pop", "dream pop"],
};

function Harness({
	description: initialDescription = null,
	genres: initialGenres = [],
	startEditing = false,
}: {
	description?: string | null;
	genres?: string[];
	startEditing?: boolean;
}) {
	const [description, setDescription] = useState<string | null>(
		initialDescription,
	);
	const [genres, setGenres] = useState<string[]>(initialGenres);
	const [isEditing, setIsEditing] = useState(startEditing);
	const [draftDescription, setDraftDescription] = useState(
		startEditing ? (initialDescription ?? "") : "",
	);
	const [draftGenres, setDraftGenres] = useState<string[]>(
		startEditing ? initialGenres : [],
	);

	const open = () => {
		setDraftDescription(description ?? "");
		setDraftGenres(genres);
		setIsEditing(true);
	};

	return (
		<div className="theme-bg mx-auto max-w-lg p-10">
			<Surface
				description={description}
				genres={genres}
				isEditing={isEditing}
				draftDescription={draftDescription}
				draftGenres={draftGenres}
				topGenres={TOP_GENRES}
				onEditDescription={open}
				onEditGenres={open}
				onDraftDescriptionChange={setDraftDescription}
				onDraftGenresChange={setDraftGenres}
				onSave={() => {
					setDescription(draftDescription.trim() || null);
					setGenres(draftGenres);
					setIsEditing(false);
				}}
				onCancel={() => setIsEditing(false)}
			/>
		</div>
	);
}

export const WritingSurface: Story<{
	description: string;
	genres: string;
	startEditing: boolean;
}> = ({ description, genres, startEditing }) => (
	<Harness
		key={`${description}|${genres}|${startEditing}`}
		description={description || null}
		genres={GENRE_PRESETS[genres] ?? []}
		startEditing={startEditing}
	/>
);
WritingSurface.args = {
	description: "songs that feel like a slow sunday",
	genres: "two genres",
	startEditing: false,
};
WritingSurface.argTypes = {
	description: { control: { type: "text" } },
	genres: { options: ["none", "two genres"], control: { type: "select" } },
	startEditing: { control: { type: "boolean" } },
};

/**
 * Wires AdvancedFiltersAssembly into WritingSurface's advancedFilters slot and
 * ActiveFilterChips into collapsedFiltersSlot. Production-shaped: saved filters
 * and draft filters are separate — draft seeds from saved on open, cancel reverts.
 * All CMHF-06 required states come from the optionsState + initialFilters args.
 */
function WithFiltersHarness({
	description: initialDescription = "songs that feel like a slow sunday",
	genres: initialGenres = ["indie pop", "dream pop"],
	startEditing = false,
	initialFilters,
	options,
	optionsState,
}: {
	description?: string | null;
	genres?: string[];
	startEditing?: boolean;
	initialFilters: PlaylistMatchFiltersV1;
	options: PlaylistMatchFilterOptions;
	optionsState: "ready" | "loading" | "error";
}) {
	const [description, setDescription] = useState<string | null>(
		initialDescription,
	);
	const [genres, setGenres] = useState<string[]>(initialGenres);
	const [savedFilters, setSavedFilters] =
		useState<PlaylistMatchFiltersV1>(initialFilters);
	const [isEditing, setIsEditing] = useState(startEditing);
	const [draftDescription, setDraftDescription] = useState(
		startEditing ? (initialDescription ?? "") : "",
	);
	const [draftGenres, setDraftGenres] = useState<string[]>(
		startEditing ? initialGenres : [],
	);
	const [draftFilters, setDraftFilters] =
		useState<PlaylistMatchFiltersV1>(initialFilters);

	const open = () => {
		setDraftDescription(description ?? "");
		setDraftGenres(genres);
		setDraftFilters(savedFilters);
		setIsEditing(true);
	};

	return (
		<div className="theme-bg mx-auto max-w-lg p-10">
			<Surface
				description={description}
				genres={genres}
				isEditing={isEditing}
				draftDescription={draftDescription}
				draftGenres={draftGenres}
				topGenres={TOP_GENRES}
				onEditDescription={open}
				onEditGenres={open}
				onDraftDescriptionChange={setDraftDescription}
				onDraftGenresChange={setDraftGenres}
				onSave={() => {
					setDescription(draftDescription.trim() || null);
					setGenres(draftGenres);
					setSavedFilters(draftFilters);
					setIsEditing(false);
				}}
				onCancel={() => setIsEditing(false)}
				collapsedFiltersSlot={
					!isEditing ? <ActiveFilterChips filters={savedFilters} /> : undefined
				}
				advancedFilters={
					isEditing ? (
						<AdvancedFiltersAssembly
							filters={draftFilters}
							onFiltersChange={setDraftFilters}
							options={options}
							optionsState={optionsState}
						/>
					) : undefined
				}
			/>
		</div>
	);
}

/**
 * CMHF-06 required state: no filters / collapsed advanced area.
 * Advanced filters trigger renders collapsed; no chips visible.
 */
export const AdvancedFiltersNoFilters: Story<{ startEditing: boolean }> = ({
	startEditing,
}) => (
	<WithFiltersHarness
		key={String(startEditing)}
		description="songs that feel like a slow sunday"
		genres={["indie pop", "dream pop"]}
		startEditing={startEditing}
		initialFilters={{ version: 1 }}
		options={MOCK_FILTER_OPTIONS}
		optionsState="ready"
	/>
);
AdvancedFiltersNoFilters.args = { startEditing: true };
AdvancedFiltersNoFilters.argTypes = {
	startEditing: { control: { type: "boolean" } },
};
AdvancedFiltersNoFilters.meta = {
	description:
		"No active filters — trigger is collapsed, no chips. Toggle startEditing to see both display and edit modes.",
};

/**
 * CMHF-06 required state: multiple active compact chips.
 * Three language chips + release year chip + vocals chip visible in edit mode.
 */
export const AdvancedFiltersMultipleChips: Story<{ startEditing: boolean }> = ({
	startEditing,
}) => (
	<WithFiltersHarness
		key={String(startEditing)}
		description="a bit of insecurity in my mind about relationships"
		genres={["indie pop", "indie rock"]}
		startEditing={startEditing}
		initialFilters={FILTERS_MULTI_CHIP}
		options={MOCK_FILTER_OPTIONS}
		optionsState="ready"
	/>
);
AdvancedFiltersMultipleChips.args = { startEditing: true };
AdvancedFiltersMultipleChips.argTypes = {
	startEditing: { control: { type: "boolean" } },
};
AdvancedFiltersMultipleChips.meta = {
	description:
		"Multiple active chips (Portuguese, Spanish, French, after 2000, Female). Trigger shows count badge.",
};

/**
 * CMHF-06 required state: expanded advanced filters with all controls.
 * All four control groups visible and interactive.
 */
export const AdvancedFiltersExpanded: Story<{
	optionsState: "ready" | "loading" | "error";
}> = ({ optionsState }) => (
	<WithFiltersHarness
		key={optionsState}
		description="songs that feel like a slow sunday"
		genres={["indie pop"]}
		startEditing={true}
		initialFilters={{ version: 1 }}
		options={MOCK_FILTER_OPTIONS}
		optionsState={optionsState}
	/>
);
AdvancedFiltersExpanded.args = { optionsState: "ready" };
AdvancedFiltersExpanded.argTypes = {
	optionsState: {
		options: ["ready", "loading", "error"],
		control: { type: "radio" },
	},
};
AdvancedFiltersExpanded.meta = {
	description:
		"All controls visible (Language, Vocals, Release year, Liked date). Switch optionsState to loading/error — controls disable but chips stay removable.",
};

/**
 * CMHF-06 required state: vocals detected chip state.
 * Panel auto-opens because vocalGender filter exists (simulates detector fill).
 */
export const AdvancedFiltersVocalsDetected: Story = () => (
	<WithFiltersHarness
		description="looking for songs with female vocals — soft and melancholic"
		genres={["indie pop"]}
		startEditing={true}
		initialFilters={FILTERS_VOCALS_DETECTED}
		options={MOCK_FILTER_OPTIONS}
		optionsState="ready"
	/>
);
AdvancedFiltersVocalsDetected.meta = {
	description:
		"Simulates a detector-filled vocals chip (Female). Panel auto-opens because vocalGender is present. The matching intent text contains the phrase that would have triggered detection.",
};

/**
 * CMHF-06 required state: options loading — controls disabled, chips removable.
 */
export const AdvancedFiltersOptionsLoading: Story = () => (
	<WithFiltersHarness
		description="songs that feel like a slow sunday"
		genres={["indie pop", "dream pop"]}
		startEditing={true}
		initialFilters={FILTERS_MULTI_CHIP}
		options={MOCK_FILTER_OPTIONS}
		optionsState="loading"
	/>
);
AdvancedFiltersOptionsLoading.meta = {
	description:
		"Filter options loading — all controls disabled with 'Loading filter options…' notice. Existing chips remain removable. Intent and genres remain editable.",
};

/**
 * CMHF-06 required state: options error — controls disabled, chips removable.
 */
export const AdvancedFiltersOptionsError: Story = () => (
	<WithFiltersHarness
		description="songs that feel like a slow sunday"
		genres={["indie pop", "dream pop"]}
		startEditing={true}
		initialFilters={FILTERS_MULTI_CHIP}
		options={MOCK_FILTER_OPTIONS}
		optionsState="error"
	/>
);
AdvancedFiltersOptionsError.meta = {
	description:
		"Filter options failed — controls show 'Filter options unavailable.' All chips still removable. Intent and genres still editable.",
};

/**
 * CMHF-06 required state: dense — many selected languages.
 * Eight language chips wrap into multiple rows.
 */
export const AdvancedFiltersDenseLanguages: Story = () => (
	<WithFiltersHarness
		description="songs that feel like a slow sunday"
		genres={["world music", "folk", "global"]}
		startEditing={true}
		initialFilters={FILTERS_DENSE_LANGUAGES}
		options={MOCK_FILTER_OPTIONS}
		optionsState="ready"
	/>
);
AdvancedFiltersDenseLanguages.meta = {
	description:
		"Eight selected languages — verifies chip wrapping, trigger count badge at 8, and picker ordering (selected first).",
};

/**
 * CMHF-06 required state: sparse option bounds.
 * Release year min/max null + liked-date oldest null → add/edit hidden,
 * but existing active chips for those filters remain visible and removable.
 */
export const AdvancedFiltersSparseOptions: Story = () => (
	<WithFiltersHarness
		description="songs I liked a while back — no idea when exactly"
		genres={[]}
		startEditing={true}
		initialFilters={FILTERS_SPARSE_BOUNDS}
		options={MOCK_SPARSE_OPTIONS}
		optionsState="ready"
	/>
);
AdvancedFiltersSparseOptions.meta = {
	description:
		"Sparse option bounds: releaseYears.min/max = null, likedAt.oldest = null. The Release year and Liked date add/edit controls are hidden, but existing chips (release year 1990–2000, liked after 2021-06-01) remain visible and removable.",
};

/**
 * CMHF-06 required state: composed with existing intent text + genre pills.
 */
export const AdvancedFiltersWithIntentAndGenres: Story<{
	startEditing: boolean;
}> = ({ startEditing }) => (
	<WithFiltersHarness
		key={String(startEditing)}
		description="hazy psychedelic folk with a coastal drift — think Joni Mitchell meets Grateful Dead at dawn"
		genres={[
			"folk rock",
			"psychedelic folk",
			"singer-songwriter",
			"west coast",
		]}
		startEditing={startEditing}
		initialFilters={FILTERS_MULTI_CHIP}
		options={MOCK_FILTER_OPTIONS}
		optionsState="ready"
	/>
);
AdvancedFiltersWithIntentAndGenres.args = { startEditing: false };
AdvancedFiltersWithIntentAndGenres.argTypes = {
	startEditing: { control: { type: "boolean" } },
};
AdvancedFiltersWithIntentAndGenres.meta = {
	description:
		"Full composition: intent text + 4 genre pills + multiple active filter chips. Toggle startEditing to check display vs. edit layout. Verifies the three sections stack cleanly without colliding.",
};

const FILTER_PRESETS: Record<string, PlaylistMatchFiltersV1> = {
	"no filters": { version: 1 },
	"language + year": {
		version: 1,
		languages: { codes: ["en", "pt"] },
		releaseYear: { kind: "after", start: 2000 },
	},
	"vocals only": { version: 1, vocalGender: "female" },
};

function WithFiltersHarnessLegacy({
	description: initialDescription = "songs that feel like a slow sunday",
	genres: initialGenres = ["indie pop", "dream pop"],
	startEditing = false,
	filterPreset = "no filters",
}: {
	description?: string | null;
	genres?: string[];
	startEditing?: boolean;
	filterPreset?: string;
}) {
	const [description, setDescription] = useState<string | null>(
		initialDescription,
	);
	const [genres, setGenres] = useState<string[]>(initialGenres);
	const [savedFilters, setSavedFilters] = useState<PlaylistMatchFiltersV1>(
		FILTER_PRESETS[filterPreset] ?? { version: 1 },
	);
	const [isEditing, setIsEditing] = useState(startEditing);
	const [draftDescription, setDraftDescription] = useState(
		startEditing ? (initialDescription ?? "") : "",
	);
	const [draftGenres, setDraftGenres] = useState<string[]>(
		startEditing ? initialGenres : [],
	);
	const [draftFilters, setDraftFilters] = useState<PlaylistMatchFiltersV1>(
		FILTER_PRESETS[filterPreset] ?? { version: 1 },
	);

	const open = () => {
		setDraftDescription(description ?? "");
		setDraftGenres(genres);
		setDraftFilters(savedFilters);
		setIsEditing(true);
	};

	return (
		<div className="theme-bg mx-auto max-w-lg p-10">
			<Surface
				description={description}
				genres={genres}
				isEditing={isEditing}
				draftDescription={draftDescription}
				draftGenres={draftGenres}
				topGenres={TOP_GENRES}
				onEditDescription={open}
				onEditGenres={open}
				onDraftDescriptionChange={setDraftDescription}
				onDraftGenresChange={setDraftGenres}
				onSave={() => {
					setDescription(draftDescription.trim() || null);
					setGenres(draftGenres);
					setSavedFilters(draftFilters);
					setIsEditing(false);
				}}
				onCancel={() => setIsEditing(false)}
				collapsedFiltersSlot={
					!isEditing ? <ActiveFilterChips filters={savedFilters} /> : undefined
				}
				advancedFilters={
					isEditing ? (
						<AdvancedFiltersAssembly
							filters={draftFilters}
							onFiltersChange={setDraftFilters}
							options={MOCK_FILTER_OPTIONS}
							optionsState="ready"
						/>
					) : undefined
				}
			/>
		</div>
	);
}

export const WritingSurfaceWithAdvancedFilters: Story<{
	description: string;
	genres: string;
	startEditing: boolean;
	filterPreset: string;
}> = ({ description, genres, startEditing, filterPreset }) => (
	<WithFiltersHarnessLegacy
		key={`${description}|${genres}|${startEditing}|${filterPreset}`}
		description={description || null}
		genres={GENRE_PRESETS[genres] ?? []}
		startEditing={startEditing}
		filterPreset={filterPreset}
	/>
);
WritingSurfaceWithAdvancedFilters.args = {
	description: "songs that feel like a slow sunday",
	genres: "two genres",
	startEditing: true,
	filterPreset: "no filters",
};
WritingSurfaceWithAdvancedFilters.argTypes = {
	description: { control: { type: "text" } },
	genres: { options: ["none", "two genres"], control: { type: "select" } },
	startEditing: { control: { type: "boolean" } },
	filterPreset: {
		options: Object.keys(FILTER_PRESETS),
		control: { type: "select" },
	},
};

/**
 * CMHF-15: inline save error state.
 * Simulates the state SpotlightPanel produces after a failed save: editor open,
 * draft intact, isSaving=false, saveError set. Cancel would clear the error.
 */
export const SaveError: Story = () => (
	<div className="theme-bg mx-auto max-w-lg p-10">
		<Surface
			description="songs that feel like a slow sunday"
			genres={["indie pop", "dream pop"]}
			isEditing={true}
			draftDescription="songs that feel like a slow sunday"
			draftGenres={["indie pop", "dream pop"]}
			topGenres={TOP_GENRES}
			isSaving={false}
			saveError="Couldn't save changes. Try again."
			onEditDescription={() => {}}
			onEditGenres={() => {}}
			onDraftDescriptionChange={() => {}}
			onDraftGenresChange={() => {}}
			onSave={() => {}}
			onCancel={() => {}}
		/>
	</div>
);
SaveError.meta = {
	description:
		"CMHF-15: inline save error displayed near Save. Editor stays open, draft intact. role=alert for screen readers.",
};

/**
 * CMHF-15: save pending state.
 * Simulates SpotlightPanel while the save RPC is in flight: isSaving=true, no error.
 */
export const SavePending: Story = () => (
	<div className="theme-bg mx-auto max-w-lg p-10">
		<Surface
			description="songs that feel like a slow sunday"
			genres={["indie pop", "dream pop"]}
			isEditing={true}
			draftDescription="songs that feel like a slow sunday"
			draftGenres={["indie pop", "dream pop"]}
			topGenres={TOP_GENRES}
			isSaving={true}
			saveError={null}
			onEditDescription={() => {}}
			onEditGenres={() => {}}
			onDraftDescriptionChange={() => {}}
			onDraftGenresChange={() => {}}
			onSave={() => {}}
			onCancel={() => {}}
		/>
	</div>
);
SavePending.meta = {
	description:
		"CMHF-15: Save button shows 'Saving…' and is disabled. Cancel disabled while in flight.",
};
