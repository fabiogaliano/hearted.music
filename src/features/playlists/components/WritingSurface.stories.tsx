import type { Story } from "@ladle/react";
import { useState } from "react";
import { TOP_GENRES } from "./fixtures";
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
