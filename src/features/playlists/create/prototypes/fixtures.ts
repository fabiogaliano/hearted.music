/**
 * Local, prototype-only fixtures for U3 (match-reason hints + starting
 * presets). Copied real-shaped song data from
 * `src/lib/domains/playlists/fixtures.ts` and extended with fictional fields
 * (`matchReason`, `matchedGenre`, `releaseYear`) the real engine doesn't
 * expose yet — kept local per the plan so the shared fixtures file stays
 * untouched while another task may be editing it concurrently.
 */

import type { PresetVM, SongWithReason } from "./types";

export const PROTO_PREVIEW_SONGS: SongWithReason[] = [
	{
		id: "proto-song-01",
		spotifyId: "6b2oQwSGFkzsMtQruIWm2p",
		name: "Last Nite",
		artist: "The Strokes",
		album: "Is This It",
		imageUrl:
			"https://i.scdn.co/image/ab67616d00001e0213f2466b83507515291acce4",
		genres: ["indie rock", "alternative rock"],
		durationMs: 193000,
		matchScore: 0.91,
		matchReason: "Indie rock · 2001",
		matchedGenre: "indie",
		releaseYear: 2001,
	},
	{
		id: "proto-song-02",
		spotifyId: "3qiyyUfYe7CRYLucrPmulH",
		name: "Don't Start Now",
		artist: "Dua Lipa",
		album: "Future Nostalgia",
		imageUrl:
			"https://i.scdn.co/image/ab67616d00001e02c88bae7846e62a8ba59ee0bd",
		genres: ["pop", "dance pop"],
		durationMs: 183000,
		matchScore: 0.87,
		matchReason: "Matches your Pop pick · 2020",
		matchedGenre: "pop",
		releaseYear: 2020,
	},
	{
		id: "proto-song-03",
		spotifyId: "4UXqAaa6dQYAk18Ol9kyxV",
		name: "Kill Bill",
		artist: "SZA",
		album: "SOS",
		imageUrl:
			"https://i.scdn.co/image/ab67616d00001e02bc18bdade69ec5ef0bb25b17",
		genres: ["rnb", "alternative r&b"],
		durationMs: 154000,
		matchScore: 0.83,
		matchReason: "From your top artist SZA",
		releaseYear: 2022,
	},
	{
		id: "proto-song-04",
		spotifyId: "4GdHGQlSNDIAz23DViQc3N",
		name: "BIRDS OF A FEATHER",
		artist: "Billie Eilish",
		album: "HIT ME HARD AND SOFT",
		imageUrl:
			"https://i.scdn.co/image/ab67616d00001e0271d62ea7ea8a5be92d3c1f62",
		genres: ["indie pop", "alternative"],
		durationMs: 210000,
		matchScore: 0.79,
		matchReason: "Matches your Indie pick · 2024",
		matchedGenre: "indie",
		releaseYear: 2024,
	},
	{
		id: "proto-song-05",
		spotifyId: "3BovdzfaX4jN5EhTNQLVQd",
		name: "Hilarity Duff",
		artist: "KAYTRANADA",
		album: "Hilarity Duff EP",
		imageUrl:
			"https://i.scdn.co/image/ab67616d00001e0270cd916cc7d895fb5e648a7f",
		genres: ["house", "electronic", "dance"],
		durationMs: 237000,
		matchScore: 0.76,
		matchReason: "Matches your Electronic pick · 2019",
		matchedGenre: "electronic",
		releaseYear: 2019,
	},
];

export const PROTO_SUGGESTIONS: SongWithReason[] = [
	{
		id: "proto-sug-01",
		spotifyId: "7ouMYWpwJ422jRcDASZB7P",
		name: "Bohemian Rhapsody",
		artist: "Queen",
		album: "A Night At The Opera",
		imageUrl:
			"https://i.scdn.co/image/ab67616d00001e02ce4f1737bc8a646c8c4bd25a",
		genres: ["rock", "classic rock"],
		durationMs: 355000,
		matchScore: 0.71,
		matchReason: "Classic rock · 1975",
		releaseYear: 1975,
	},
	{
		id: "proto-sug-02",
		spotifyId: "3qT4bUD1MaWpGrTwcvguhb",
		name: "Training Season",
		artist: "Dua Lipa",
		album: "Radical Optimism",
		imageUrl:
			"https://i.scdn.co/image/ab67616d00001e022f8790ed72296c2614607575",
		genres: ["pop", "dance pop"],
		durationMs: 210000,
		matchScore: 0.69,
		matchReason: "Matches your Pop pick · 2024",
		matchedGenre: "pop",
		releaseYear: 2024,
	},
	{
		id: "proto-sug-03",
		spotifyId: "5ghIJDpPoe3CfHMGu71E6T",
		name: "Jaded",
		artist: "Lone",
		album: "Reality Testing",
		imageUrl:
			"https://i.scdn.co/image/ab67616d00001e0258d3c41ece17b5a6ac257eda",
		genres: ["electronic", "house", "ambient"],
		durationMs: 311000,
		matchScore: 0.65,
		matchReason: "Matches your Electronic pick · 2019",
		matchedGenre: "electronic",
		releaseYear: 2019,
	},
	{
		id: "proto-sug-04",
		spotifyId: "2tVHmZTRZe51cWFkMFtTFB",
		name: "Fair",
		artist: "TEED",
		album: "Trouble",
		imageUrl:
			"https://i.scdn.co/image/ab67616d00001e02ba02d709c8aeaf8ed0e80dc4",
		genres: ["indie", "indie pop"],
		durationMs: 189000,
		matchScore: 0.62,
		matchReason: "Matches your Indie pick · 2012",
		matchedGenre: "indie",
		releaseYear: 2012,
	},
	{
		id: "proto-sug-05",
		spotifyId: "1BxfuPKGuaTgP7aM0Chatn",
		name: "BUS RIDE",
		artist: "KAYTRANADA",
		album: "99.9%",
		imageUrl:
			"https://i.scdn.co/image/ab67616d00001e0242c18fe458181bc13d08070a",
		genres: ["house", "electronic", "funk"],
		durationMs: 280000,
		matchScore: 0.58,
		matchReason: "From your top artist KAYTRANADA",
		releaseYear: 2016,
	},
];

/** Active genre pills for the believable list context (pill-echo direction). */
export const PROTO_ACTIVE_GENRE_PILLS = ["indie", "pop", "electronic"];

/**
 * Plausible per-user data seeding the starting-presets directions: a top
 * genre, a favorite decade, and "recent favorites" — the kind of aggregates
 * the account's liked-songs history could produce. Fictional; the real
 * preset feature would derive these server-side.
 */
export const PROTO_PRESETS: PresetVM[] = [
	{
		id: "preset-recent-favorites",
		label: "Recent favorites",
		description: "Songs you've liked in the last 30 days",
		genrePills: [],
		intent: undefined,
	},
	{
		id: "preset-top-genre",
		label: "All things indie",
		description: "Your most-liked genre, 340 songs deep",
		genrePills: ["indie", "indie rock"],
	},
	{
		id: "preset-throwbacks",
		label: "Throwbacks: 2010s",
		description: "Liked songs released between 2010–2019",
		genrePills: [],
		intent: "Nostalgic throwback to the 2010s",
	},
	{
		id: "preset-late-night",
		label: "Late-night electronic",
		description: "Your house & electronic picks after 10pm listens",
		genrePills: ["electronic", "house"],
		intent: "Late-night, slow-building electronic",
	},
];
