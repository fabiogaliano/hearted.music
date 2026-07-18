/**
 * Realistic fixture data for the playlist creation preview engine.
 *
 * Song selection and metadata mirror real music so Ladle stories and
 * unit tests feel like the live product rather than lorem-ipsum placeholders.
 * These are the same tracks referenced in the existing playlists fixtures to
 * keep visual coherence across stories.
 */

import type { SongVM } from "./types";

export const SONG_FIXTURES: SongVM[] = [
	{
		id: "song-01",
		spotifyId: "6b2oQwSGFkzsMtQruIWm2p",
		name: "Last Nite",
		artist: "The Strokes",
		album: "Is This It",
		imageUrl:
			"https://i.scdn.co/image/ab67616d00001e0213f2466b83507515291acce4",
		genres: ["indie rock", "alternative rock"],
		durationMs: 193000,
		matchScore: 0.91,
	},
	{
		id: "song-02",
		spotifyId: "3qiyyUfYe7CRYLucrPmulH",
		name: "Don't Start Now",
		artist: "Dua Lipa",
		album: "Future Nostalgia",
		imageUrl:
			"https://i.scdn.co/image/ab67616d00001e02c88bae7846e62a8ba59ee0bd",
		genres: ["pop", "dance pop"],
		durationMs: 183000,
		matchScore: 0.87,
	},
	{
		id: "song-03",
		spotifyId: "4UXqAaa6dQYAk18Ol9kyxV",
		name: "Kill Bill",
		artist: "SZA",
		album: "SOS",
		imageUrl:
			"https://i.scdn.co/image/ab67616d00001e02bc18bdade69ec5ef0bb25b17",
		genres: ["rnb", "alternative r&b"],
		durationMs: 154000,
		matchScore: 0.83,
	},
	{
		id: "song-04",
		spotifyId: "4GdHGQlSNDIAz23DViQc3N",
		name: "BIRDS OF A FEATHER",
		artist: "Billie Eilish",
		album: "HIT ME HARD AND SOFT",
		imageUrl:
			"https://i.scdn.co/image/ab67616d00001e0271d62ea7ea8a5be92d3c1f62",
		genres: ["indie pop", "alternative"],
		durationMs: 210000,
		matchScore: 0.79,
	},
	{
		id: "song-05",
		spotifyId: "3BovdzfaX4jN5EhTNQLVQd",
		name: "Hilarity Duff",
		artist: "KAYTRANADA",
		album: "Hilarity Duff EP",
		imageUrl:
			"https://i.scdn.co/image/ab67616d00001e0270cd916cc7d895fb5e648a7f",
		genres: ["house", "electronic", "dance"],
		durationMs: 237000,
		matchScore: 0.76,
	},
	{
		id: "song-06",
		spotifyId: "6AQbmUe0Qwf5PZnt4HmTUv",
		name: "Sunday",
		artist: "HNNY",
		album: "Sunday",
		imageUrl:
			"https://i.scdn.co/image/ab67616d00001e02107d051e4c35ac3c8fe3470d",
		genres: ["deep house", "house", "electronic"],
		durationMs: 421000,
		matchScore: 0.74,
	},
	{
		id: "song-07",
		spotifyId: "7ouMYWpwJ422jRcDASZB7P",
		name: "Bohemian Rhapsody",
		artist: "Queen",
		album: "A Night At The Opera",
		imageUrl:
			"https://i.scdn.co/image/ab67616d00001e02ce4f1737bc8a646c8c4bd25a",
		genres: ["rock", "classic rock"],
		durationMs: 355000,
		matchScore: 0.71,
	},
	{
		id: "song-08",
		spotifyId: "3qT4bUD1MaWpGrTwcvguhb",
		name: "Training Season",
		artist: "Dua Lipa",
		album: "Radical Optimism",
		imageUrl:
			"https://i.scdn.co/image/ab67616d00001e022f8790ed72296c2614607575",
		genres: ["pop", "dance pop"],
		durationMs: 210000,
		matchScore: 0.69,
	},
	{
		id: "song-09",
		spotifyId: "5ghIJDpPoe3CfHMGu71E6T",
		name: "Jaded",
		artist: "Lone",
		album: "Reality Testing",
		imageUrl:
			"https://i.scdn.co/image/ab67616d00001e0258d3c41ece17b5a6ac257eda",
		genres: ["electronic", "house", "ambient"],
		durationMs: 311000,
		matchScore: 0.65,
	},
	{
		id: "song-10",
		spotifyId: "2tVHmZTRZe51cWFkMFtTFB",
		name: "Fair",
		artist: "TEED",
		album: "Trouble",
		imageUrl:
			"https://i.scdn.co/image/ab67616d00001e02ba02d709c8aeaf8ed0e80dc4",
		genres: ["indie", "indie pop"],
		durationMs: 189000,
		matchScore: 0.62,
	},
	{
		id: "song-11",
		spotifyId: "1BxfuPKGuaTgP7aM0Chatn",
		name: "BUS RIDE",
		artist: "KAYTRANADA",
		album: "99.9%",
		imageUrl:
			"https://i.scdn.co/image/ab67616d00001e0242c18fe458181bc13d08070a",
		genres: ["house", "electronic", "funk"],
		durationMs: 280000,
		matchScore: 0.58,
	},
	{
		id: "song-12",
		spotifyId: "6I9VzXrHxO9rA9A5euc8Ak",
		name: "It's Good To Try",
		artist: "Laurence Guy",
		album: "Making Music Is Bad For Your Self Esteem",
		imageUrl:
			"https://i.scdn.co/image/ab67616d00001e02bda1c2e6f854b16df5f0b420",
		genres: ["deep house", "electronic"],
		durationMs: 344000,
		matchScore: 0.55,
	},
];

/** A realistic preview set (first 5 songs). */
export const FIXTURE_PREVIEW: SongVM[] = SONG_FIXTURES.slice(0, 5);

/** A realistic suggestions tray (next 7 songs). */
export const FIXTURE_SUGGESTIONS: SongVM[] = SONG_FIXTURES.slice(5, 12);
