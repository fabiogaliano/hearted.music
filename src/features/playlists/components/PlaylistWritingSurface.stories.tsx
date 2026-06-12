import { type ReactNode, useState } from "react";
import { fonts } from "@/lib/theme/fonts";
import { PlaylistWritingSurface } from "./PlaylistWritingSurface";

/**
 * The unified description + genres writing surface used in the playlist detail
 * view and the onboarding dialog. One Edit opens both the description textarea
 * and the genre picker; one Save/Cancel covers both. These stories own the
 * draft state and fake the save (flip out of edit mode) so no server stub is
 * needed — the real callers wire persistence and any failure UI via editFooter.
 *
 * Coverage mirrors GenrePillsPicker: the three display states, the expanded
 * editor (fresh + populated), the saving lock, the editFooter seam, and the
 * onboarding cancel label — plus one scenario that drops the surface into a
 * faithful detail-view chrome with a real playlist pulled from the local DB.
 */

export default {
	title: "Playlists/PlaylistWritingSurface",
};

const TOP_GENRES = ["rock", "pop", "hip-hop", "electronic", "rnb", "jazz"];

function Harness({
	description: initialDescription = null,
	genres: initialGenres = [],
	startEditing = false,
	isSaving = false,
	cancelLabel,
	saveLabel,
	editFooter,
	topGenres = TOP_GENRES,
}: {
	description?: string | null;
	genres?: string[];
	startEditing?: boolean;
	isSaving?: boolean;
	cancelLabel?: string;
	saveLabel?: string;
	editFooter?: ReactNode;
	topGenres?: string[];
}) {
	const [description, setDescription] = useState<string | null>(
		initialDescription,
	);
	const [genres, setGenres] = useState<string[]>(initialGenres);
	const [isEditing, setIsEditing] = useState(startEditing);
	// When a story opens straight into the editor, seed the drafts from the saved
	// values up front; the display-affordance click does the same seeding via `open`.
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
			<PlaylistWritingSurface
				description={description}
				genres={genres}
				isEditing={isEditing}
				draftDescription={draftDescription}
				draftGenres={draftGenres}
				topGenres={topGenres}
				isSaving={isSaving}
				cancelLabel={cancelLabel}
				saveLabel={saveLabel}
				editFooter={editFooter}
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
			<pre className="theme-text-muted mt-8 text-xs">
				description = {JSON.stringify(description)}
				{"\n"}genres = {JSON.stringify(genres)}
			</pre>
		</div>
	);
}

// Failure UI is caller-owned and slots in below Save/Cancel via editFooter; each
// caller passes its own. This mirrors the detail view's save-failed alert so the
// seam is visible in isolation, without depending on a real save flow.
function SaveFailedFooter() {
	return (
		<div role="alert" className="flex items-center gap-2">
			<span
				aria-hidden="true"
				className="theme-primary-bg inline-block size-1.5 flex-shrink-0 rounded-full"
			/>
			<p
				className="theme-text-muted text-xs leading-relaxed"
				style={{ fontFamily: fonts.body }}
			>
				Something went sideways saving that. Try again?
			</p>
		</div>
	);
}

export const Empty = () => <Harness />;

export const WithDescription = () => (
	<Harness description="made with ♪ by @inotbeingf" />
);

export const WithDescriptionAndGenres = () => (
	<Harness
		description="songs i run to at 6am"
		genres={["indie", "electronic", "rock"]}
	/>
);

// Editor opened on a brand-new playlist: empty textarea, no chips, the genre
// picker offering quick-picks seeded from the account's top genres.
export const EditingEmpty = () => <Harness startEditing />;

// Editor opened on an existing playlist: drafts seeded from the saved
// description and chips.
export const Editing = () => (
	<Harness
		description="songs i run to at 6am"
		genres={["indie", "electronic"]}
		startEditing
	/>
);

// Save in flight: textarea, picker, and both buttons disabled; Save reads
// "Saving…".
export const Saving = () => (
	<Harness
		description="songs i run to at 6am"
		genres={["indie", "electronic"]}
		startEditing
		isSaving
	/>
);

// The editFooter seam: a caller's save-failed message rendered under Save/Cancel
// while editing.
export const EditingWithFooter = () => (
	<Harness
		description="songs i run to at 6am"
		genres={["indie"]}
		startEditing
		editFooter={<SaveFailedFooter />}
	/>
);

// A caller can reword the dismiss button via cancelLabel — here "Skip for now"
// instead of the default "Cancel".
export const OnboardingCancelLabel = () => (
	<Harness
		description="made with ♪ by @inotbeingf"
		startEditing
		cancelLabel="Skip for now"
	/>
);

// The onboarding dialog passes saveLabel="Continue and save" so the primary
// button reads as the step-advancing verb; the in-flight "Saving…" label is
// unchanged.
export const OnboardingSaveLabel = () => (
	<Harness
		description="made with ♪ by @inotbeingf"
		startEditing
		saveLabel="Continue and save"
	/>
);

// Pulled from the local Supabase `playlist` table — a real Spotify cover, name,
// description, and song count. No row in the DB has genre pills yet, so the chips
// start empty; adding them in the editor shows the engine working on a real
// playlist.
const REAL_PLAYLIST = {
	name: "Super Bock Super Rock 2021",
	description: "made with ♪ by @inotbeingf",
	imageUrl:
		"https://image-cdn-ak.spotifycdn.com/image/ab67706c0000da84c1975a91a3224aa534fc35ba",
	songCount: 14,
	genres: [] as string[],
};

// A faithful slice of PlaylistDetailView's header — cover, tiered title, the
// writing surface — so the surface can be seen exactly as it sits in /playlists,
// minus the morph geometry and track list that don't matter here.
function DetailChrome({
	name,
	description: initialDescription,
	imageUrl,
	songCount,
	genres: initialGenres,
}: {
	name: string;
	description: string | null;
	imageUrl: string;
	songCount: number;
	genres: string[];
}) {
	const [description, setDescription] = useState<string | null>(
		initialDescription,
	);
	const [genres, setGenres] = useState<string[]>(initialGenres);
	const [isEditing, setIsEditing] = useState(false);
	const [draftDescription, setDraftDescription] = useState("");
	const [draftGenres, setDraftGenres] = useState<string[]>([]);

	const open = () => {
		setDraftDescription(description ?? "");
		setDraftGenres(genres);
		setIsEditing(true);
	};

	// Mirror the detail view's title tiering so a real name sizes the same here.
	const titleSizeClass =
		name.length <= 24
			? "text-5xl"
			: name.length <= 60
				? "text-4xl"
				: "text-3xl";
	const titleWeightClass = name.length <= 24 ? "font-extralight" : "font-light";

	return (
		<div className="theme-bg min-h-screen px-6 py-10">
			<div className="mx-auto max-w-3xl">
				<div className="grid grid-cols-[14rem_1fr] gap-x-8">
					<div className="image-outline size-56 self-start overflow-hidden shadow-xl">
						<img src={imageUrl} alt="" className="h-full w-full object-cover" />
					</div>

					<div className="flex min-w-0 flex-col">
						<h2
							className={`theme-text mb-3 line-clamp-2 leading-[0.95] tracking-tight text-balance ${titleSizeClass} ${titleWeightClass}`}
							style={{ fontFamily: fonts.display }}
						>
							{name}
						</h2>
						<p
							className="theme-text-muted mb-5 text-xs tabular-nums"
							style={{ fontFamily: fonts.body }}
						>
							{songCount} {songCount === 1 ? "song" : "songs"}
						</p>

						<div className="max-w-lg">
							<PlaylistWritingSurface
								description={description}
								genres={genres}
								isEditing={isEditing}
								draftDescription={draftDescription}
								draftGenres={draftGenres}
								topGenres={TOP_GENRES}
								descriptionViewTransitionName="playlist-description"
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
					</div>
				</div>
			</div>
		</div>
	);
}

export const RealPlaylist = () => <DetailChrome {...REAL_PLAYLIST} />;
