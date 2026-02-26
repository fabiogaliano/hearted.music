export interface TestSong {
	artist: string;
	title: string;
	spotifyTrackId?: string;
	album?: string;
}

export const DEFAULT_TEST_SONGS: TestSong[] = [
	{
		artist: "The Weeknd",
		title: "Blinding Lights",
		spotifyTrackId: "0VjIjW4GlUZAMYd2vXMi3b",
		album: "After Hours",
	},
	{
		artist: "Queen",
		title: "Bohemian Rhapsody",
		spotifyTrackId: "4u7EnebtmKWzUH433cf5Qv",
		album: "A Night at the Opera",
	},
	{
		artist: "Bon Iver",
		title: "Skinny Love",
		spotifyTrackId: "1ZbSMEkjLFaDgUmWRbByPG",
		album: "For Emma, Forever Ago",
	},
	{
		artist: "Kendrick Lamar",
		title: "HUMBLE.",
		spotifyTrackId: "7KXjTSCq5nL1LoYtL7XAwS",
		album: "DAMN.",
	},
	{
		artist: "Lorde",
		title: "Ribs",
		spotifyTrackId: "1UqhkbfIBxnHRkZIJYPxmV",
		album: "Pure Heroine",
	},
];
