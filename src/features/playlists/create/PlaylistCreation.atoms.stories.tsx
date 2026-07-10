/**
 * Playlist Creation — atomic component stories.
 *
 * Every named export becomes a flat leaf under "Playlist Creation/" in the
 * Ladle sidebar. No bare "Default" stories — each one renders a real piece
 * with real-shaped data.
 *
 * Components that use useQuery internally (GenreConfig, FiltersConfig,
 * ConfigSurface) are wrapped in a story-local QueryClientProvider pre-seeded
 * with realistic filter options and top genres so they render with real content
 * instead of the loading/error skeleton.
 */

import type { Story } from "@ladle/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { useSingleActivePlayback } from "@/features/playback/useSingleActivePlayback";
import { MOCK_FILTER_OPTIONS } from "@/features/playlists/components/match-filters/mock-filter-options";
import { playlistKeys } from "@/features/playlists/queries";
import {
	FIXTURE_SUGGESTIONS,
	SONG_FIXTURES,
} from "@/lib/domains/playlists/fixtures";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import { ConfigSurface } from "./config/ConfigSurface";
import { FiltersConfig } from "./config/FiltersConfig";
import { GenreConfig } from "./config/GenreConfig";
import { IntentEditor } from "./config/IntentEditor";
import { CreateBar } from "./create-flow/CreateBar";
import { ExtensionUnavailablePrompt } from "./create-flow/ExtensionUnavailablePrompt";
import { LibraryEmptyState } from "./create-flow/LibraryEmptyState";
import { NotEnoughSongsNote } from "./create-flow/NotEnoughSongsNote";
import { PartialState } from "./create-flow/PartialState";
import { ReconnectPrompt } from "./create-flow/ReconnectPrompt";
import { SuccessState } from "./create-flow/SuccessState";
import {
	MAX_SONGS_DEFAULT,
	MAX_SONGS_MAX,
	MAX_SONGS_MIN,
	MAX_SONGS_STEP,
	MaxSongsSlider,
} from "./MaxSongsSlider";
import { PreviewList } from "./preview/PreviewList";
import { PreviewSongRow } from "./preview/PreviewSongRow";
import { SuggestionRow } from "./suggestions/SuggestionRow";
import { SuggestionsTray } from "./suggestions/SuggestionsTray";

// ─── Shared seeded QueryClient factory ───────────────────────────────────────

const STORY_ACCOUNT_ID = "story-account";

const STORY_TOP_GENRES = [
	"indie",
	"electronic",
	"pop",
	"rock",
	"hip-hop",
	"rnb",
	"jazz",
	"house",
];

/**
 * Creates a QueryClient pre-seeded with realistic filter options and top genres
 * so components that call useQuery (GenreConfig, FiltersConfig, ConfigSurface)
 * render with real content without triggering any network requests.
 */
function makeSeededQueryClient(): QueryClient {
	const qc = new QueryClient({
		defaultOptions: {
			queries: { retry: false, refetchOnWindowFocus: false, gcTime: Infinity },
		},
	});
	qc.setQueryData(
		playlistKeys.filterOptions(STORY_ACCOUNT_ID),
		MOCK_FILTER_OPTIONS,
	);
	qc.setQueryData(playlistKeys.topGenres(STORY_ACCOUNT_ID), {
		genres: STORY_TOP_GENRES,
	});
	return qc;
}

export default { title: "Playlist Creation" };

// ─── MaxSongsSlider ───────────────────────────────────────────────────────────

export const MaxSongsSliderStory: Story<{ value: number }> = ({ value }) => {
	const [v, setV] = useState(value);
	return (
		<div className="mx-auto max-w-xs p-10">
			<MaxSongsSlider value={v} onChange={setV} />
		</div>
	);
};
MaxSongsSliderStory.storyName = "Max Songs Slider";
MaxSongsSliderStory.args = { value: MAX_SONGS_DEFAULT };
MaxSongsSliderStory.argTypes = {
	value: {
		control: {
			type: "range",
			min: MAX_SONGS_MIN,
			max: MAX_SONGS_MAX,
			step: MAX_SONGS_STEP,
		},
	},
};

// ─── IntentEditor ─────────────────────────────────────────────────────────────

export const IntentEditorPremium: Story = () => {
	const [intent, setIntent] = useState<string | undefined>(
		"Late-night drive through an empty city — melancholic but not sad",
	);
	return (
		<div className="mx-auto max-w-lg p-10">
			<IntentEditor
				isEligible={true}
				value={intent}
				onChange={setIntent}
				onOpenPaywall={() => alert("paywall")}
			/>
		</div>
	);
};
IntentEditorPremium.storyName = "Intent Editor — Premium";

export const IntentEditorLocked: Story = () => (
	<div className="mx-auto max-w-lg p-10">
		<IntentEditor
			isEligible={false}
			value={undefined}
			onChange={() => {}}
			onOpenPaywall={() => alert("upgrade dialog")}
		/>
	</div>
);
IntentEditorLocked.storyName = "Intent Editor — Locked (free)";

// ─── PreviewSongRow ───────────────────────────────────────────────────────────

// Fixtures are a statically-defined const array; the indices below are
// always within bounds — at() returns undefined only for dynamic input.
const PREVIEW_ROW_SONG = SONG_FIXTURES.at(0) ?? SONG_FIXTURES[0];
const PREVIEW_ROW_NEW_SONG = SONG_FIXTURES.at(3) ?? SONG_FIXTURES[0];

// Row stories create their own useSingleActivePlayback instance (a hook can
// only run inside a component) so the cover renders the real play affordance
// instead of the static fallback — mirrors how CreatePlaylistScreen wires it.
export const PreviewRowStory: Story = () => {
	const playback = useSingleActivePlayback();
	return (
		<div className="mx-auto max-w-lg p-8">
			<ul>
				<li style={{ listStyle: "none" }}>
					<PreviewSongRow
						song={PREVIEW_ROW_SONG}
						onRemove={() => {}}
						playback={playback}
					/>
				</li>
			</ul>
		</div>
	);
};
PreviewRowStory.storyName = "Preview Row";

export const PreviewRowNew: Story = () => {
	const playback = useSingleActivePlayback();
	return (
		<div className="mx-auto max-w-lg p-8">
			<ul>
				<li style={{ listStyle: "none" }}>
					<PreviewSongRow
						song={PREVIEW_ROW_NEW_SONG}
						onRemove={() => {}}
						isNew={true}
						playback={playback}
					/>
				</li>
			</ul>
		</div>
	);
};
PreviewRowNew.storyName = "Preview Row — just added (highlight)";

// ─── PreviewList ──────────────────────────────────────────────────────────────

export const PreviewListStory: Story = () => {
	const [songs, setSongs] = useState(SONG_FIXTURES.slice(0, 15));
	const [newIds] = useState<ReadonlySet<string>>(new Set());
	const playback = useSingleActivePlayback();
	return (
		<div className="mx-auto max-w-lg p-8">
			<PreviewList
				songs={songs}
				isLoading={false}
				onRemoveSong={(id) =>
					setSongs((prev) => prev.filter((s) => s.id !== id))
				}
				onRestoreSong={() => {}}
				newSongIds={newIds}
				playback={playback}
			/>
		</div>
	);
};
PreviewListStory.storyName = "Preview List";

export const PreviewListLoading: Story = () => (
	<div className="mx-auto max-w-lg p-8">
		<PreviewList
			songs={[]}
			isLoading={true}
			onRemoveSong={() => {}}
			onRestoreSong={() => {}}
		/>
	</div>
);
PreviewListLoading.storyName = "Preview List — loading";

export const PreviewListEmpty: Story = () => (
	<div className="mx-auto max-w-lg p-8">
		<PreviewList
			songs={[]}
			isLoading={false}
			onRemoveSong={() => {}}
			onRestoreSong={() => {}}
		/>
	</div>
);
PreviewListEmpty.storyName = "Preview List — empty";

// ─── SuggestionRow ────────────────────────────────────────────────────────────

const SUGGESTION_ROW_SONG = FIXTURE_SUGGESTIONS.at(0) ?? FIXTURE_SUGGESTIONS[0];

export const SuggestionRowStory: Story = () => {
	const playback = useSingleActivePlayback();
	return (
		<div className="mx-auto max-w-lg p-8">
			<ul>
				<li style={{ listStyle: "none" }}>
					<SuggestionRow
						song={SUGGESTION_ROW_SONG}
						onAdd={() => {}}
						onDismiss={() => {}}
						playback={playback}
					/>
				</li>
			</ul>
		</div>
	);
};
SuggestionRowStory.storyName = "Suggestion Row";

// ─── SuggestionsTray ─────────────────────────────────────────────────────────

export const SuggestionsTrayStory: Story = () => {
	const [suggestions, setSuggestions] = useState([...FIXTURE_SUGGESTIONS]);
	const playback = useSingleActivePlayback();
	return (
		<div className="mx-auto max-w-lg p-8">
			<SuggestionsTray
				suggestions={suggestions}
				onAddSong={(id) =>
					setSuggestions((prev) => prev.filter((s) => s.id !== id))
				}
				onDismissSong={(id) =>
					setSuggestions((prev) => prev.filter((s) => s.id !== id))
				}
				onRefresh={() => setSuggestions((prev) => [...prev].reverse())}
				playback={playback}
			/>
		</div>
	);
};
SuggestionsTrayStory.storyName = "Suggestions Tray";

export const SuggestionsTrayEmpty: Story = () => (
	<div className="mx-auto max-w-lg p-8">
		<SuggestionsTray
			suggestions={[]}
			onAddSong={() => {}}
			onDismissSong={() => {}}
			onRefresh={() => {}}
		/>
	</div>
);
SuggestionsTrayEmpty.storyName = "Suggestions Tray — empty";

// ─── CreateBar ────────────────────────────────────────────────────────────────

const EMPTY_FILTERS: PlaylistMatchFiltersV1 = { version: 1 };

export const CreateBarReady: Story<{ songCount: number }> = ({ songCount }) => {
	const songIds = SONG_FIXTURES.slice(0, songCount).map((s) => s.id);
	return (
		<div className="mx-auto max-w-2xl">
			<div className="theme-border-color border border-t-0">
				<div className="theme-border-color border-b px-6 py-3">
					<span className="theme-text-muted text-[11px] tracking-[0.2em] uppercase">
						Create
					</span>
				</div>
				<CreateBar
					songIds={songIds}
					genrePills={["indie", "electronic"]}
					matchFilters={EMPTY_FILTERS}
					intentApplied={false}
					intent={null}
					isPreviewStale={false}
					gateState="ok"
					recheck={async () => {}}
					onNameCommit={() => {}}
					onResult={() => {}}
				/>
			</div>
		</div>
	);
};
CreateBarReady.storyName = "Create Bar — Ready";
CreateBarReady.args = { songCount: 15 };
CreateBarReady.argTypes = {
	songCount: {
		control: { type: "range", min: 0, max: SONG_FIXTURES.length, step: 1 },
	},
};

export const CreateBarReconnect: Story = () => (
	<div className="mx-auto max-w-2xl">
		<div className="theme-border-color border border-t-0">
			<div className="theme-border-color border-b px-6 py-3">
				<span className="theme-text-muted text-[11px] tracking-[0.2em] uppercase">
					Create
				</span>
			</div>
			<CreateBar
				songIds={SONG_FIXTURES.slice(0, 15).map((s) => s.id)}
				genrePills={[]}
				matchFilters={EMPTY_FILTERS}
				intentApplied={false}
				intent={null}
				isPreviewStale={false}
				gateState="reconnect-required"
				recheck={async () => {}}
				onNameCommit={() => {}}
				onResult={() => {}}
			/>
		</div>
	</div>
);
CreateBarReconnect.storyName = "Create Bar — Reconnect";

export const CreateBarExtensionMissing: Story = () => (
	<div className="mx-auto max-w-2xl">
		<div className="theme-border-color border border-t-0">
			<div className="theme-border-color border-b px-6 py-3">
				<span className="theme-text-muted text-[11px] tracking-[0.2em] uppercase">
					Create
				</span>
			</div>
			<CreateBar
				songIds={SONG_FIXTURES.slice(0, 15).map((s) => s.id)}
				genrePills={[]}
				matchFilters={EMPTY_FILTERS}
				intentApplied={false}
				intent={null}
				isPreviewStale={false}
				gateState="extension-unavailable"
				recheck={async () => {}}
				onNameCommit={() => {}}
				onResult={() => {}}
			/>
		</div>
	</div>
);
CreateBarExtensionMissing.storyName = "Create Bar — Extension Missing";

// ─── SuccessState ─────────────────────────────────────────────────────────────

export const Success: Story = () => (
	<div className="mx-auto max-w-2xl">
		<div className="theme-border-color border border-t-0">
			<div className="theme-border-color border-b px-6 py-3">
				<span className="theme-text-muted text-[11px] tracking-[0.2em] uppercase">
					Create
				</span>
			</div>
			<SuccessState
				playlistName="Late Night Drives"
				spotifyId="3cEYpjA9oz9GiPac4AsH4n"
				playlistId="a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7"
			/>
		</div>
	</div>
);
Success.storyName = "Success State";

// ─── PartialState ─────────────────────────────────────────────────────────────

export const Partial: Story<{ failedTrackCount: number }> = ({
	failedTrackCount,
}) => (
	<div className="mx-auto max-w-2xl">
		<div className="theme-border-color border border-t-0">
			<div className="theme-border-color border-b px-6 py-3">
				<span className="theme-text-muted text-[11px] tracking-[0.2em] uppercase">
					Create
				</span>
			</div>
			<PartialState
				spotifyId="3cEYpjA9oz9GiPac4AsH4n"
				playlistId="a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7"
				failedTrackCount={failedTrackCount}
			/>
		</div>
	</div>
);
Partial.storyName = "Partial — songs couldn't be added";
Partial.args = { failedTrackCount: 15 };
Partial.argTypes = {
	failedTrackCount: {
		control: { type: "range", min: 1, max: 30, step: 1 },
	},
};

// ─── ReconnectPrompt ─────────────────────────────────────────────────────────

export const ReconnectPromptStory: Story = () => (
	<div className="mx-auto max-w-2xl">
		<div className="theme-border-color border border-t-0">
			<div className="theme-border-color border-b px-6 py-3">
				<span className="theme-text-muted text-[11px] tracking-[0.2em] uppercase">
					Create
				</span>
			</div>
			<ReconnectPrompt onRecheck={async () => {}} />
		</div>
	</div>
);
ReconnectPromptStory.storyName = "Reconnect Prompt";

// ─── ExtensionUnavailablePrompt ───────────────────────────────────────────────

export const ExtensionMissingStory: Story = () => (
	<div className="mx-auto max-w-2xl">
		<div className="theme-border-color border border-t-0">
			<div className="theme-border-color border-b px-6 py-3">
				<span className="theme-text-muted text-[11px] tracking-[0.2em] uppercase">
					Create
				</span>
			</div>
			<ExtensionUnavailablePrompt onRecheck={async () => {}} />
		</div>
	</div>
);
ExtensionMissingStory.storyName = "Extension Missing";

// ─── LibraryEmptyState ────────────────────────────────────────────────────────

export const LibraryWarming: Story = () => (
	<div className="mx-auto max-w-lg p-8">
		<LibraryEmptyState isWarming={true} />
	</div>
);
LibraryWarming.storyName = "Library Warming";

export const LibraryEmpty: Story = () => (
	<div className="mx-auto max-w-lg p-8">
		<LibraryEmptyState isWarming={false} />
	</div>
);
LibraryEmpty.storyName = "Library Empty";

// ─── NotEnoughSongsNote ───────────────────────────────────────────────────────

export const NotEnoughSongs: Story<{ totalEligible: number }> = ({
	totalEligible,
}) => (
	<div className="mx-auto max-w-lg p-8">
		<NotEnoughSongsNote totalEligible={totalEligible} />
	</div>
);
NotEnoughSongs.storyName = "Not Enough Songs";
NotEnoughSongs.args = { totalEligible: 8 };
NotEnoughSongs.argTypes = {
	totalEligible: {
		control: { type: "range", min: 1, max: 14, step: 1 },
	},
};

// ─── GenreConfig ──────────────────────────────────────────────────────────────

/**
 * Thin controlled wrapper around GenrePillsPicker, seeded with account top
 * genres so the quick-pick row is populated. Story wraps in a seeded
 * QueryClientProvider so the internal useQuery resolves immediately from cache.
 */
export const GenreConfigStory: Story = () => {
	const [genres, setGenres] = useState<string[]>(["indie", "electronic"]);
	return (
		<QueryClientProvider client={makeSeededQueryClient()}>
			<div className="mx-auto max-w-lg p-10">
				<GenreConfig
					accountId={STORY_ACCOUNT_ID}
					value={genres}
					onChange={setGenres}
				/>
			</div>
		</QueryClientProvider>
	);
};
GenreConfigStory.storyName = "Genre Config";

export const GenreConfigEmpty: Story = () => {
	const [genres, setGenres] = useState<string[]>([]);
	return (
		<QueryClientProvider client={makeSeededQueryClient()}>
			<div className="mx-auto max-w-lg p-10">
				<GenreConfig
					accountId={STORY_ACCOUNT_ID}
					value={genres}
					onChange={setGenres}
				/>
			</div>
		</QueryClientProvider>
	);
};
GenreConfigEmpty.storyName = "Genre Config — empty";

// ─── FiltersConfig ────────────────────────────────────────────────────────────

/**
 * Thin controlled wrapper around MatchFiltersFieldList. Story wraps in a seeded
 * QueryClientProvider so filter options (languages, release-year bounds,
 * liked-at bounds) are available immediately from cache.
 */
export const FiltersConfigStory: Story = () => {
	const [filters, setFilters] = useState<PlaylistMatchFiltersV1>({
		version: 1,
		vocalGender: "female",
		releaseYear: { kind: "range", start: 2000, end: 2024 },
	});
	return (
		<QueryClientProvider client={makeSeededQueryClient()}>
			<div className="mx-auto max-w-lg p-10">
				<FiltersConfig
					accountId={STORY_ACCOUNT_ID}
					value={filters}
					onChange={setFilters}
				/>
			</div>
		</QueryClientProvider>
	);
};
FiltersConfigStory.storyName = "Filters Config";

export const FiltersConfigNone: Story = () => {
	const [filters, setFilters] = useState<PlaylistMatchFiltersV1>({
		version: 1,
	});
	return (
		<QueryClientProvider client={makeSeededQueryClient()}>
			<div className="mx-auto max-w-lg p-10">
				<FiltersConfig
					accountId={STORY_ACCOUNT_ID}
					value={filters}
					onChange={setFilters}
				/>
			</div>
		</QueryClientProvider>
	);
};
FiltersConfigNone.storyName = "Filters Config — no active filters";

// ─── ConfigSurface ────────────────────────────────────────────────────────────

/**
 * The full config surface: IntentEditor + GenreConfig + FiltersConfig +
 * MaxSongsSlider assembled in the real two-column grid. Seeded QueryClient
 * provides filter options and top genres so all sub-components render fully.
 */
export const ConfigSurfaceStory: Story = () => {
	const [intent, setIntent] = useState<string | undefined>(
		"Late-night drive through an empty city — melancholic but not sad",
	);
	const [genres, setGenres] = useState<string[]>(["indie", "electronic"]);
	const [filters, setFilters] = useState<PlaylistMatchFiltersV1>({
		version: 1,
		vocalGender: "female",
	});
	const [maxSongs, setMaxSongs] = useState(MAX_SONGS_DEFAULT);
	return (
		<QueryClientProvider client={makeSeededQueryClient()}>
			<div className="mx-auto max-w-2xl p-10">
				<ConfigSurface
					accountId={STORY_ACCOUNT_ID}
					isIntentEligible={true}
					intent={intent}
					genrePills={genres}
					matchFilters={filters}
					maxSongs={maxSongs}
					onIntentChange={setIntent}
					onGenrePillsChange={setGenres}
					onMatchFiltersChange={setFilters}
					onMaxSongsChange={setMaxSongs}
					onOpenPaywall={() => {}}
				/>
			</div>
		</QueryClientProvider>
	);
};
ConfigSurfaceStory.storyName = "Config Surface";

export const ConfigSurfaceLocked: Story = () => {
	const [genres, setGenres] = useState<string[]>(["indie", "rock"]);
	const [filters, setFilters] = useState<PlaylistMatchFiltersV1>({
		version: 1,
	});
	const [maxSongs, setMaxSongs] = useState(MAX_SONGS_DEFAULT);
	return (
		<QueryClientProvider client={makeSeededQueryClient()}>
			<div className="mx-auto max-w-2xl p-10">
				<ConfigSurface
					accountId={STORY_ACCOUNT_ID}
					isIntentEligible={false}
					intent={undefined}
					genrePills={genres}
					matchFilters={filters}
					maxSongs={maxSongs}
					onIntentChange={() => {}}
					onGenrePillsChange={setGenres}
					onMatchFiltersChange={setFilters}
					onMaxSongsChange={setMaxSongs}
					onOpenPaywall={() => {}}
				/>
			</div>
		</QueryClientProvider>
	);
};
ConfigSurfaceLocked.storyName = "Config Surface — intent locked (free)";
