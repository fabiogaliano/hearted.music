import type { Story } from "@ladle/react";
import { useState } from "react";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import { TOP_GENRES } from "./fixtures";
import { AdvancedFiltersPanel } from "./match-filters/AdvancedFiltersPanel";
import { WritingSurface as Surface } from "./WritingSurface";

/**
 * The lab-faithful writing surface in isolation. The harness owns draft state
 * and fakes the save (flip out of edit). The controls cover every state: clear
 * `description` + "none" genres for empty, flip `startEditing` for the editor.
 */
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

// The harness seeds all of its draft state on mount, so key to every control
// that seeds it to remount cleanly when any of them change.
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

const FILTER_PRESETS: Record<string, PlaylistMatchFiltersV1> = {
	"no filters": { version: 1 },
	"language + year": {
		version: 1,
		languages: { codes: ["en", "pt"] },
		releaseYear: { kind: "after", start: 2000 },
	},
	"vocals only": { version: 1, vocalGender: "female" },
};

function WithFiltersHarness({
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
	const [isEditing, setIsEditing] = useState(startEditing);
	const [draftDescription, setDraftDescription] = useState(
		startEditing ? (initialDescription ?? "") : "",
	);
	const [draftGenres, setDraftGenres] = useState<string[]>(
		startEditing ? initialGenres : [],
	);
	const [filters, setFilters] = useState<PlaylistMatchFiltersV1>(
		FILTER_PRESETS[filterPreset] ?? { version: 1 },
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
				advancedFilters={
					<AdvancedFiltersPanel
						filters={filters}
						onFiltersChange={setFilters}
					/>
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
	<WithFiltersHarness
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
