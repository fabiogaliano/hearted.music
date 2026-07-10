/**
 * Playlist Creation — composable "feel it" stories.
 *
 * Three rich, fully-assembled full-screen compositions seeded with believable
 * prod-like data so a reviewer can feel the real experience. All three render
 * the REAL production components (ConfigSurface → IntentEditor + GenreConfig +
 * FiltersConfig + MaxSongsSlider, PreviewList, SuggestionsTray, CreateBar)
 * assembled exactly as CreatePlaylistScreen does.
 *
 * QueryClient seeding: FiltersConfig and GenreConfig call useQuery internally.
 * A per-story QueryClient is pre-seeded with realistic filter options and top
 * genres so the facets and genre quick-picks render with real content instead
 * of the error/loading skeleton.
 *
 * Shares the same flat title group "Playlist Creation" as the atom stories so
 * the sidebar is one flat list.
 */

import type { Story } from "@ladle/react";
import { ArrowLeftIcon } from "@phosphor-icons/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { MOCK_FILTER_OPTIONS } from "@/features/playlists/components/match-filters/mock-filter-options";
import { playlistKeys } from "@/features/playlists/queries";
import { SONG_FIXTURES } from "@/lib/domains/playlists/fixtures";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import { fonts } from "@/lib/theme/fonts";
import { ConfigSurface } from "./config/ConfigSurface";
import { CreateBar } from "./create-flow/CreateBar";
import { LibraryEmptyState } from "./create-flow/LibraryEmptyState";
import { NotEnoughSongsNote } from "./create-flow/NotEnoughSongsNote";
import { MAX_SONGS_DEFAULT } from "./MaxSongsSlider";
import { PreviewList } from "./preview/PreviewList";
import { SuggestionsTray } from "./suggestions/SuggestionsTray";

export default { title: "Playlist Creation" };

// ─── Story account id used for cache seeding ──────────────────────────────────

const STORY_ACCOUNT_ID = "story-account";

const TOP_GENRES = [
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
 * Creates a QueryClient pre-seeded with:
 *  - Realistic filter options (languages, release-year bounds, liked-at bounds)
 *    so FiltersConfig renders its facets instead of the "unavailable" error state.
 *  - Account top genres so GenreConfig's quick-pick row is populated.
 *
 * Each story instantiates its own client so seed data is isolated.
 */
function makeSeededQueryClient(): QueryClient {
	const qc = new QueryClient({
		defaultOptions: {
			queries: { retry: false, refetchOnWindowFocus: false, gcTime: Infinity },
		},
	});

	// Seed filter options so FiltersConfig renders "ready" instead of "error".
	qc.setQueryData(
		playlistKeys.filterOptions(STORY_ACCOUNT_ID),
		MOCK_FILTER_OPTIONS,
	);

	// Seed top genres so GenreConfig's GenrePillsPicker quick-picks are populated.
	qc.setQueryData(playlistKeys.topGenres(STORY_ACCOUNT_ID), {
		genres: TOP_GENRES,
	});

	return qc;
}

// ─── Extended fixture set for the full-screen stories ────────────────────────

// 20 songs for a rich, believable preview — mix of genres and artists.
const EXTENDED_SONGS = [
	...SONG_FIXTURES,
	{
		id: "song-ext-01",
		spotifyId: "2374M0fQpWi3dLnB54qaLX",
		name: "Electric Feel",
		artist: "MGMT",
		album: "Oracular Spectacular",
		imageUrl:
			"https://i.scdn.co/image/ab67616d00001e028db4e24a903e0f9d279b1091",
		genres: ["indie pop", "psychedelic"],
		durationMs: 229000,
		matchScore: 0.54,
	},
	{
		id: "song-ext-02",
		spotifyId: "4bHsxqR3GMrXTxEPLuK5ue",
		name: "Midnight City",
		artist: "M83",
		album: "Hurry Up, We're Dreaming",
		imageUrl:
			"https://i.scdn.co/image/ab67616d00001e02f4395c07e74edb71f35fb614",
		genres: ["synthpop", "dream pop", "indie"],
		durationMs: 243000,
		matchScore: 0.51,
	},
	{
		id: "song-ext-03",
		spotifyId: "6b2oQwSGFkzsMtQruIWm2p",
		name: "Pumped Up Kicks",
		artist: "Foster the People",
		album: "Torches",
		imageUrl:
			"https://i.scdn.co/image/ab67616d00001e02d7f3d1bc7e9282f11f4e00c0",
		genres: ["indie pop", "alternative"],
		durationMs: 239000,
		matchScore: 0.48,
	},
	{
		id: "song-ext-04",
		spotifyId: "0VjIjW4GlUZAMYd2vXMi3b",
		name: "Blinding Lights",
		artist: "The Weeknd",
		album: "After Hours",
		imageUrl:
			"https://i.scdn.co/image/ab67616d00001e028863bc11d2aa12b54f5aeb36",
		genres: ["synth-pop", "pop"],
		durationMs: 200000,
		matchScore: 0.46,
	},
	{
		id: "song-ext-05",
		spotifyId: "4iV5W9uYEdYUVa79Axb7Rh",
		name: "Dreams",
		artist: "Fleetwood Mac",
		album: "Rumours",
		imageUrl:
			"https://i.scdn.co/image/ab67616d00001e02e52a59a28efa4773dd2bfe1b",
		genres: ["soft rock", "classic rock"],
		durationMs: 254000,
		matchScore: 0.44,
	},
	{
		id: "song-ext-06",
		spotifyId: "6rqhFgbbKwnb9MLmUQDhG6",
		name: "Heat Waves",
		artist: "Glass Animals",
		album: "Dreamland",
		imageUrl:
			"https://i.scdn.co/image/ab67616d00001e02712701c5e263efc8726b1464",
		genres: ["indie pop", "psychedelic pop"],
		durationMs: 238000,
		matchScore: 0.42,
	},
	{
		id: "song-ext-07",
		spotifyId: "40riOy7x9W7GXjyGp4pjAv",
		name: "lovely (with Khalid)",
		artist: "Billie Eilish",
		album: "13 Reasons Why (Soundtrack)",
		imageUrl:
			"https://i.scdn.co/image/ab67616d00001e024ae30d2f09e9f17d2ea27518",
		genres: ["indie pop", "alternative"],
		durationMs: 200000,
		matchScore: 0.39,
	},
	{
		id: "song-ext-08",
		spotifyId: "3n3Ppam7vgaVa1iaRUIOKE",
		name: "Mr. Brightside",
		artist: "The Killers",
		album: "Hot Fuss",
		imageUrl:
			"https://i.scdn.co/image/ab67616d00001e02a0ff7c4a62bd9be7484daecb",
		genres: ["indie rock", "alternative"],
		durationMs: 222000,
		matchScore: 0.37,
	},
];

const PREVIEW_SONGS_PREMIUM = EXTENDED_SONGS.slice(0, 20);

const SUGGESTIONS_PREMIUM = [
	{
		id: "sug-01",
		spotifyId: "1je1IMUlBXcx1Fz0WE7oPT",
		name: "Golden",
		artist: "Harry Styles",
		album: "Fine Line",
		imageUrl:
			"https://i.scdn.co/image/ab67616d00001e02731eb8a44b2ba0f0b7bcd0e5",
		genres: ["pop", "indie pop"],
		durationMs: 209000,
		matchScore: 0.73,
	},
	{
		id: "sug-02",
		spotifyId: "2dpaYNEQHiRxtZbfNsse99",
		name: "As It Was",
		artist: "Harry Styles",
		album: "Harry's House",
		imageUrl:
			"https://i.scdn.co/image/ab67616d00001e025204f3c5c83f5f5f0f5f5f5f",
		genres: ["pop", "indie pop"],
		durationMs: 167000,
		matchScore: 0.7,
	},
	{
		id: "sug-03",
		spotifyId: "3Ofmpyhv5UAQ7CPMwMaQw6",
		name: "Levitating",
		artist: "Dua Lipa",
		album: "Future Nostalgia",
		imageUrl:
			"https://i.scdn.co/image/ab67616d00001e02c88bae7846e62a8ba59ee0bd",
		genres: ["pop", "disco pop"],
		durationMs: 204000,
		matchScore: 0.68,
	},
	{
		id: "sug-04",
		spotifyId: "7MXVkk9YMctZqd1Srtv4MB",
		name: "Watermelon Sugar",
		artist: "Harry Styles",
		album: "Fine Line",
		imageUrl:
			"https://i.scdn.co/image/ab67616d00001e02731eb8a44b2ba0f0b7bcd0e5",
		genres: ["pop", "indie pop"],
		durationMs: 174000,
		matchScore: 0.65,
	},
	{
		id: "sug-05",
		spotifyId: "6Qs4SBOBHLhWmEHlzExJJV",
		name: "Stargazing",
		artist: "Kygo",
		album: "Stargazing",
		imageUrl:
			"https://i.scdn.co/image/ab67616d00001e02a33e097cac6d1f4e7f5f5f5f",
		genres: ["tropical house", "electronic"],
		durationMs: 220000,
		matchScore: 0.63,
	},
	{
		id: "sug-06",
		spotifyId: "0DiWol3AO6WpXZgdaURkvQ",
		name: "Adorn",
		artist: "Miguel",
		album: "Kaleidoscope Dream",
		imageUrl:
			"https://i.scdn.co/image/ab67616d00001e024b697b8b35fa9faf49ac8a1c",
		genres: ["rnb", "soul"],
		durationMs: 194000,
		matchScore: 0.6,
	},
	{
		id: "sug-07",
		spotifyId: "2EEeOnHehOozLq4aS0n6SL",
		name: "Come & Get It",
		artist: "Baauer",
		album: "Aa",
		imageUrl:
			"https://i.scdn.co/image/ab67616d00001e02ccc1e0dedc36f4ab56f67e69",
		genres: ["trap", "electronic"],
		durationMs: 195000,
		matchScore: 0.57,
	},
	{
		id: "sug-08",
		spotifyId: "5wANPM4fQCJwkW0jf21CWU",
		name: "Retrograde",
		artist: "James Blake",
		album: "Overgrown",
		imageUrl:
			"https://i.scdn.co/image/ab67616d00001e024561577f30c1fb36a040898d",
		genres: ["electronic", "indie"],
		durationMs: 230000,
		matchScore: 0.54,
	},
];

// ─── Full screen layout using the REAL production components ─────────────────

/**
 * Assembles the create-playlist page exactly as CreatePlaylistScreen does, but
 * driven by local fixture state instead of the live useCreatePlaylistDraft hook.
 * QueryClient is injected as a prop so each story uses its own seeded instance.
 */
function FullScreenHarness({
	queryClient,
	isIntentEligible,
	initialIntent,
	initialGenres,
	initialFilters,
	previewSongs: initialPreview,
	suggestions: initialSuggestions,
	totalEligible,
	gateState,
	showNotEnoughNote,
	isWarming,
}: {
	queryClient: QueryClient;
	isIntentEligible: boolean;
	initialIntent?: string;
	initialGenres: string[];
	initialFilters: PlaylistMatchFiltersV1;
	previewSongs: typeof PREVIEW_SONGS_PREMIUM;
	suggestions: typeof SUGGESTIONS_PREMIUM;
	totalEligible: number;
	gateState: "ok" | "reconnect-required" | "extension-unavailable";
	showNotEnoughNote: boolean;
	isWarming: boolean;
}) {
	const [intent, setIntent] = useState<string | undefined>(initialIntent);
	const [genres, setGenres] = useState<string[]>(initialGenres);
	const [filters, setFilters] =
		useState<PlaylistMatchFiltersV1>(initialFilters);
	const [maxSongs, setMaxSongs] = useState(MAX_SONGS_DEFAULT);
	const [preview, setPreview] = useState(initialPreview);
	const [suggestions, setSuggestions] = useState(initialSuggestions);
	const [newSongIds] = useState<ReadonlySet<string>>(new Set());

	function handleRemoveSong(id: string) {
		setPreview((prev) => prev.filter((s) => s.id !== id));
	}

	function handleAddSuggestion(id: string) {
		const song = suggestions.find((s) => s.id === id);
		if (!song) return;
		setSuggestions((prev) => prev.filter((s) => s.id !== id));
		setPreview((prev) => [...prev, song]);
	}

	function handleDismissSuggestion(id: string) {
		setSuggestions((prev) => prev.filter((s) => s.id !== id));
	}

	function handleRefreshSuggestions() {
		// Story-only stand-in for "page deeper": reverse order so the batch
		// visibly rotates without needing a real server round-trip.
		setSuggestions((prev) => [...prev].reverse());
	}

	return (
		// Nest a story-local QueryClientProvider so the pre-seeded filter options
		// and top genres are available to ConfigSurface → GenreConfig/FiltersConfig
		// without triggering real network requests.
		<QueryClientProvider client={queryClient}>
			<div className="mx-auto max-w-[1180px] pb-24 px-6">
				{/* Page header */}
				<header className="mb-10 flex items-start justify-between gap-6">
					<div className="flex flex-col gap-1">
						<button
							type="button"
							className="theme-text-muted -ml-0.5 mb-3 inline-flex cursor-pointer items-center gap-1.5 text-[11px] tracking-widest uppercase transition-opacity duration-150 hover:opacity-70"
							style={{ fontFamily: fonts.body }}
						>
							<ArrowLeftIcon size={11} weight="regular" aria-hidden />
							Playlists
						</button>
						<h1
							className="theme-text text-page-title leading-[0.95] font-extralight tracking-tight text-balance"
							style={{ fontFamily: fonts.display }}
						>
							New playlist
						</h1>
					</div>
				</header>

				{/* Configure — real ConfigSurface (IntentEditor + GenreConfig + FiltersConfig + MaxSongsSlider) */}
				<section className="mb-10">
					<div className="mb-6 flex items-center gap-4 px-1">
						<span
							className="theme-text-muted text-xs tracking-[0.2em] uppercase"
							style={{ fontFamily: fonts.body }}
						>
							Configure
						</span>
						<div className="theme-border-color h-px flex-1 border-t" />
					</div>

					<ConfigSurface
						accountId={STORY_ACCOUNT_ID}
						isIntentEligible={isIntentEligible}
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
				</section>

				{/* Preview */}
				<section className="mb-10">
					<div className="mb-6 flex items-center justify-between gap-4 px-1">
						<div className="flex items-center gap-4">
							<span
								className="theme-text-muted text-xs tracking-[0.2em] uppercase"
								style={{ fontFamily: fonts.body }}
							>
								Preview
							</span>
							<div className="theme-border-color h-px w-20 border-t" />
							{totalEligible > 0 && (
								<span
									className="theme-text-muted text-xs tabular-nums"
									style={{ fontFamily: fonts.body }}
								>
									{preview.length} of {totalEligible} eligible
								</span>
							)}
						</div>
					</div>

					{isWarming ? (
						<LibraryEmptyState isWarming={true} />
					) : totalEligible === 0 ? (
						<LibraryEmptyState isWarming={false} />
					) : (
						<PreviewList
							songs={preview}
							isLoading={false}
							onRemoveSong={handleRemoveSong}
							onRestoreSong={() => {}}
							newSongIds={newSongIds}
						/>
					)}

					{showNotEnoughNote && (
						<div className="mt-3">
							<NotEnoughSongsNote totalEligible={totalEligible} />
						</div>
					)}
				</section>

				{/* Suggestions */}
				<section className="mb-10">
					<div className="mb-6 flex items-center gap-4 px-1">
						<span
							className="theme-text-muted text-xs tracking-[0.2em] uppercase"
							style={{ fontFamily: fonts.body }}
						>
							Suggested to add
						</span>
						<div className="theme-border-color h-px flex-1 border-t" />
					</div>
					<SuggestionsTray
						suggestions={suggestions}
						onAddSong={handleAddSuggestion}
						onDismissSong={handleDismissSuggestion}
						onRefresh={handleRefreshSuggestions}
					/>
				</section>

				{/* Create section */}
				<div className="theme-border-color border border-t-0">
					<div className="theme-border-color border-b px-6 py-3">
						<span
							className="theme-text-muted text-[11px] tracking-[0.2em] uppercase"
							style={{ fontFamily: fonts.body }}
						>
							Create
						</span>
					</div>
					<CreateBar
						songIds={preview.map((s) => s.id)}
						genrePills={genres}
						matchFilters={filters}
						intentApplied={isIntentEligible && !!intent}
						intent={intent ?? null}
						isPreviewStale={false}
						gateState={gateState}
						recheck={async () => {}}
						onNameCommit={() => {}}
						onResult={() => {}}
					/>
				</div>
			</div>
		</QueryClientProvider>
	);
}

// ─── Full Screen — Premium (intent applied) ───────────────────────────────────

/**
 * The flagship "feel it" story. Intent phrase filled, 3 genre pills, slider at
 * 20, 20-song preview, 8 distinct suggestions, ready CreateBar. The real
 * ConfigSurface renders with seeded filter options (all facets populated) and
 * seeded top genres (quick-picks visible). Everything is interactive.
 */
export const FullScreenPremium: Story = () => (
	<FullScreenHarness
		queryClient={makeSeededQueryClient()}
		isIntentEligible={true}
		initialIntent="Late-night drive through an empty city — melancholic but not sad, layered electronic textures"
		initialGenres={["indie", "electronic", "house"]}
		initialFilters={{
			version: 1,
			vocalGender: "female",
			releaseYear: { kind: "range", start: 2000, end: 2024 },
		}}
		previewSongs={PREVIEW_SONGS_PREMIUM}
		suggestions={SUGGESTIONS_PREMIUM}
		totalEligible={247}
		gateState="ok"
		showNotEnoughNote={false}
		isWarming={false}
	/>
);
FullScreenPremium.storyName = "Full Screen — Premium (intent applied)";
FullScreenPremium.meta = {
	description:
		"Full production experience: intent phrase filled, 3 genre pills, 2 active filters (female vocals + 2000–2024 era), slider at 20, 20-song preview, 8 suggestions, ready CreateBar. ConfigSurface is the real component with seeded filter options. Remove songs, add suggestions, edit the intent.",
};

// ─── Full Screen — Free (intent locked) ──────────────────────────────────────

/**
 * Same richness but IntentEditor shows the locked teaser (free tier). Genre
 * pills and filters remain fully usable. 15 songs, 6 suggestions.
 */
export const FullScreenFree: Story = () => (
	<FullScreenHarness
		queryClient={makeSeededQueryClient()}
		isIntentEligible={false}
		initialIntent={undefined}
		initialGenres={["indie", "rock"]}
		initialFilters={{ version: 1 }}
		previewSongs={PREVIEW_SONGS_PREMIUM.slice(0, 15)}
		suggestions={SUGGESTIONS_PREMIUM.slice(0, 6)}
		totalEligible={183}
		gateState="ok"
		showNotEnoughNote={false}
		isWarming={false}
	/>
);
FullScreenFree.storyName = "Full Screen — Free (intent locked)";
FullScreenFree.meta = {
	description:
		"Free tier: intent field shows the locked teaser with the Backstage Pass CTA. Genre pills and filters are fully interactive (seeded options). 15-song preview, 6 suggestions, ready CreateBar.",
};

// ─── Full Screen — Warming up ─────────────────────────────────────────────────

/**
 * Library-warming state: Phase-1 enrichment just kicked off, nothing has
 * cleared enrichment yet, so totalEligible === 0. Preview shows the warming
 * message; config and create bar stay visible so the user can configure while
 * waiting.
 */
export const FullScreenWarmingUp: Story = () => (
	<FullScreenHarness
		queryClient={makeSeededQueryClient()}
		isIntentEligible={true}
		initialIntent={undefined}
		initialGenres={[]}
		initialFilters={{ version: 1 }}
		previewSongs={[]}
		suggestions={[]}
		totalEligible={0}
		gateState="ok"
		showNotEnoughNote={false}
		isWarming={true}
	/>
);
FullScreenWarmingUp.storyName = "Full Screen — Warming up";
FullScreenWarmingUp.meta = {
	description:
		"Library warming state: Phase-1 enrichment just triggered, no songs have cleared it yet. Preview shows 'Still warming up your library…'. Config and create bar stay visible. Filter options and top genres are seeded so ConfigSurface renders fully.",
};
