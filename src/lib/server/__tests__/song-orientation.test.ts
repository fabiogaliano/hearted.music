import { describe, expect, it } from "vitest";
import {
	mapSongOrientationRows,
	type SongOrientationSuggestionEntry,
} from "../match-review-queue.read";

// ---------------------------------------------------------------------------
// Minimal fixtures
// ---------------------------------------------------------------------------

const BASE_SONG = {
	id: "song-1",
	spotify_id: "sp-1",
	name: "Test Song",
	artists: ["Test Artist"],
	album_name: "Test Album",
	image_url: "img.jpg",
	genres: ["pop"],
};

const BASE_AUDIO = { tempo: 120, energy: 0.8, valence: 0.6 };

const BASE_ANALYSIS = {
	headline: "A bold track",
	compound_mood: "energetic",
	mood_description: "upbeat",
	interpretation: "full of life",
	themes: [{ name: "freedom", description: "soaring" }],
	journey: [{ section: "verse", mood: "calm", description: "starts slow" }],
	key_lines: [{ line: "fly high", insight: "ambition" }],
	sonic_texture: "bright",
};

const BASE_PLAYLIST = {
	id: "pl-1",
	name: "Playlist 1",
	match_intent: "chill vibes",
	song_count: 20,
	image_url: "pl.jpg",
	spotify_id: "sp-pl-1",
};

function suggestion(
	overrides: Partial<SongOrientationSuggestionEntry> = {},
): SongOrientationSuggestionEntry {
	return {
		songId: "song-1",
		playlistId: "pl-1",
		fitScore: 0.9,
		visibleRank: 1,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("mapSongOrientationRows", () => {
	it("returns missing-song when song is null", () => {
		const result = mapSongOrientationRows(
			null,
			BASE_AUDIO,
			BASE_ANALYSIS,
			[BASE_PLAYLIST],
			[suggestion()],
		);
		expect(result.status).toBe("missing-song");
	});

	it("returns playlist-error when playlists is null", () => {
		const result = mapSongOrientationRows(
			BASE_SONG,
			BASE_AUDIO,
			BASE_ANALYSIS,
			null,
			[suggestion()],
		);
		expect(result.status).toBe("playlist-error");
	});

	it("returns ok with fully populated reviewItem on happy path", () => {
		const result = mapSongOrientationRows(
			BASE_SONG,
			BASE_AUDIO,
			BASE_ANALYSIS,
			[BASE_PLAYLIST],
			[suggestion()],
		);

		expect(result.status).toBe("ok");
		if (result.status !== "ok") return;

		expect(result.reviewItem).toMatchObject({
			id: "song-1",
			spotifyId: "sp-1",
			name: "Test Song",
			artist: "Test Artist",
			album: "Test Album",
			albumArtUrl: "img.jpg",
			genres: ["pop"],
			audioFeatures: { tempo: 120, energy: 0.8, valence: 0.6 },
			analysis: BASE_ANALYSIS,
		});
	});

	it("sets audioFeatures to null when audio row is null (null-coalescing)", () => {
		const result = mapSongOrientationRows(
			BASE_SONG,
			null,
			BASE_ANALYSIS,
			[BASE_PLAYLIST],
			[suggestion()],
		);

		expect(result.status).toBe("ok");
		if (result.status !== "ok") return;
		expect(result.reviewItem.audioFeatures).toBeNull();
	});

	it("sets analysis to null when analysis is null (null-coalescing)", () => {
		const result = mapSongOrientationRows(
			BASE_SONG,
			BASE_AUDIO,
			null,
			[BASE_PLAYLIST],
			[suggestion()],
		);

		expect(result.status).toBe("ok");
		if (result.status !== "ok") return;
		expect(result.reviewItem.analysis).toBeNull();
	});

	it("falls back to 'Unknown Artist' when artists array is empty (null-coalescing)", () => {
		const result = mapSongOrientationRows(
			{ ...BASE_SONG, artists: [] },
			null,
			null,
			[BASE_PLAYLIST],
			[suggestion()],
		);

		expect(result.status).toBe("ok");
		if (result.status !== "ok") return;
		expect(result.reviewItem.artist).toBe("Unknown Artist");
	});

	it("returns ok with empty suggestions when no suggestions are supplied", () => {
		const result = mapSongOrientationRows(
			BASE_SONG,
			BASE_AUDIO,
			BASE_ANALYSIS,
			[BASE_PLAYLIST],
			[],
		);

		expect(result.status).toBe("ok");
		if (result.status !== "ok") return;
		expect(result.suggestions).toHaveLength(0);
	});

	it("sorts suggestions by visibleRank ascending regardless of input order", () => {
		const playlists = [
			{ ...BASE_PLAYLIST, id: "pl-a", name: "A" },
			{ ...BASE_PLAYLIST, id: "pl-b", name: "B" },
			{ ...BASE_PLAYLIST, id: "pl-c", name: "C" },
		];
		// Supplied in descending visibleRank order — mapper must re-sort.
		const suggestions = [
			suggestion({ playlistId: "pl-c", visibleRank: 3, fitScore: 0.95 }),
			suggestion({ playlistId: "pl-a", visibleRank: 1, fitScore: 0.7 }),
			suggestion({ playlistId: "pl-b", visibleRank: 2, fitScore: 0.85 }),
		];

		const result = mapSongOrientationRows(
			BASE_SONG,
			null,
			null,
			playlists,
			suggestions,
		);

		expect(result.status).toBe("ok");
		if (result.status !== "ok") return;
		expect(result.suggestions.map((s) => s.playlist.id)).toEqual([
			"pl-a",
			"pl-b",
			"pl-c",
		]);
	});

	it("maps fitScore as score and visibleRank as rank on each suggestion", () => {
		const result = mapSongOrientationRows(
			BASE_SONG,
			null,
			null,
			[BASE_PLAYLIST],
			[suggestion({ fitScore: 0.77, visibleRank: 3 })],
		);

		expect(result.status).toBe("ok");
		if (result.status !== "ok") return;
		expect(result.suggestions[0].score).toBe(0.77);
		expect(result.suggestions[0].rank).toBe(3);
	});

	it("sets factors to null on every suggestion (MSR-24)", () => {
		const result = mapSongOrientationRows(
			BASE_SONG,
			null,
			null,
			[BASE_PLAYLIST],
			[suggestion()],
		);

		expect(result.status).toBe("ok");
		if (result.status !== "ok") return;
		expect(result.suggestions[0].factors).toBeNull();
	});

	it("skips suggestion entries whose playlist is not in the playlists array", () => {
		// pl-missing has no corresponding row in the playlists array.
		const result = mapSongOrientationRows(
			BASE_SONG,
			null,
			null,
			[BASE_PLAYLIST],
			[
				suggestion({ playlistId: "pl-missing", visibleRank: 1 }),
				suggestion({ playlistId: "pl-1", visibleRank: 2 }),
			],
		);

		expect(result.status).toBe("ok");
		if (result.status !== "ok") return;
		expect(result.suggestions).toHaveLength(1);
		expect(result.suggestions[0].playlist.id).toBe("pl-1");
	});

	it("maps all playlist fields onto the suggestion playlist shape", () => {
		const pl = {
			id: "pl-x",
			name: "My List",
			match_intent: "perfect for study",
			song_count: 42,
			image_url: "cover.jpg",
			spotify_id: "sp-plx",
		};

		const result = mapSongOrientationRows(
			BASE_SONG,
			null,
			null,
			[pl],
			[suggestion({ playlistId: "pl-x" })],
		);

		expect(result.status).toBe("ok");
		if (result.status !== "ok") return;
		expect(result.suggestions[0].playlist).toMatchObject({
			id: "pl-x",
			name: "My List",
			description: "perfect for study",
			trackCount: 42,
			imageUrl: "cover.jpg",
			spotifyId: "sp-plx",
		});
	});
});
