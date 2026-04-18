/**
 * Static demo playlist match data for the landing page and onboarding demo.
 * These are hand-curated matches — no DB rows involved.
 */

export interface DemoPlaylist {
	id: string;
	name: string;
	reason: string;
}

export interface DemoSongMatch {
	id: string;
	matchScore: number;
}

export interface DemoMatchPlaylist {
	id: string;
	name: string;
	reason: string;
	matchScore: number;
}

export const DEMO_PLAYLISTS: readonly DemoPlaylist[] = [
	{
		id: "1",
		name: "crying in the car",
		reason: "for when you're driving and it hits you",
	},
	{ id: "2", name: "sweaty and happy", reason: "movement that feels good" },
	{
		id: "3",
		name: "feeling everything",
		reason: "songs that meet you where you are",
	},
	{
		id: "4",
		name: "main character energy",
		reason: "when you need to feel like the point",
	},
	{
		id: "5",
		name: "3am thoughts",
		reason: "the spiral, but make it beautiful",
	},
	{ id: "6", name: "sunday softness", reason: "no urgency, just warmth" },
	{
		id: "7",
		name: "revenge era",
		reason: "when done-with-it becomes a superpower",
	},
] as const;

export const DEMO_SONG_MATCHES: Record<string, DemoSongMatch[]> = {
	// Ribs — Lorde
	"2MvvoeRt8NcOXWESkxWn3g": [
		{ id: "5", matchScore: 0.94 },
		{ id: "3", matchScore: 0.72 },
		{ id: "1", matchScore: 0.51 },
	],
	// Houdini — Dua Lipa
	"4OMJGnvZfDvsePyCwRGO7X": [
		{ id: "2", matchScore: 0.95 },
		{ id: "4", matchScore: 0.79 },
		{ id: "7", matchScore: 0.48 },
	],
	// Thinkin Bout You — Frank Ocean
	"7DfFc7a6Rwfi3YQMRbDMau": [
		{ id: "5", matchScore: 0.91 },
		{ id: "3", matchScore: 0.68 },
		{ id: "6", matchScore: 0.44 },
	],
	// Motion Sickness — Phoebe Bridgers
	"5xo8RrjJ9CVNrtRg2S3B1R": [
		{ id: "1", matchScore: 0.96 },
		{ id: "7", matchScore: 0.63 },
		{ id: "5", matchScore: 0.41 },
	],
	// Too Sweet — Hozier
	"3HMY0r2BAdpasXMY8rseR0": [
		{ id: "6", matchScore: 0.88 },
		{ id: "3", matchScore: 0.6 },
		{ id: "5", matchScore: 0.39 },
	],
	// Do I Wanna Know? — Arctic Monkeys
	"5FVd6KXrgO9B3JPmC8OPst": [
		{ id: "5", matchScore: 0.93 },
		{ id: "3", matchScore: 0.65 },
		{ id: "1", matchScore: 0.47 },
	],
	// Kill Bill — SZA
	"1Qrg8KqiBpW07V7PNxwwwL": [
		{ id: "7", matchScore: 0.92 },
		{ id: "5", matchScore: 0.74 },
		{ id: "3", matchScore: 0.5 },
	],
	// Not Like Us — Kendrick Lamar
	"6AI3ezQ4o3HUoP6Dhudph3": [
		{ id: "4", matchScore: 0.96 },
		{ id: "7", matchScore: 0.85 },
		{ id: "2", matchScore: 0.58 },
	],
	// Taxes — Geese
	"7r9BUOSnekEjrkMhmxD6Ae": [
		{ id: "1", matchScore: 0.77 },
		{ id: "6", matchScore: 0.55 },
		{ id: "5", matchScore: 0.38 },
	],
	// Beautiful Things — Benson Boone
	"6tNQ70jh4OwmPGpYy6R2o9": [
		{ id: "3", matchScore: 0.91 },
		{ id: "6", matchScore: 0.67 },
		{ id: "1", matchScore: 0.44 },
	],
	// BIRDS OF A FEATHER — Billie Eilish
	"6dOtVTDdiauQNBQEDOtlAB": [
		{ id: "3", matchScore: 0.93 },
		{ id: "6", matchScore: 0.76 },
		{ id: "5", matchScore: 0.49 },
	],
	// drivers license — Olivia Rodrigo
	"7lPN2DXiMsVn7XUKtOW1CS": [
		{ id: "1", matchScore: 0.97 },
		{ id: "3", matchScore: 0.81 },
		{ id: "5", matchScore: 0.55 },
	],
	// Pink Pony Club — Chappell Roan
	"1k2pQc5i348DCHwbn5KTdc": [
		{ id: "2", matchScore: 0.94 },
		{ id: "4", matchScore: 0.72 },
		{ id: "7", matchScore: 0.43 },
	],
	// EARFQUAKE — Tyler, the Creator
	"5hVghJ4KaYES3BFUATCYn0": [
		{ id: "3", matchScore: 0.89 },
		{ id: "5", matchScore: 0.66 },
		{ id: "6", matchScore: 0.42 },
	],
	// Blinding Lights — The Weeknd
	"0VjIjW4GlUZAMYd2vXMi3b": [
		{ id: "1", matchScore: 0.88 },
		{ id: "2", matchScore: 0.69 },
		{ id: "4", matchScore: 0.47 },
	],
	// As It Was — Harry Styles
	"4Dvkj6JhhA12EX05fT7y2e": [
		{ id: "3", matchScore: 0.82 },
		{ id: "1", matchScore: 0.61 },
		{ id: "6", matchScore: 0.4 },
	],
	// Manchild — Sabrina Carpenter
	"42UBPzRMh5yyz0EDPr6fr1": [
		{ id: "7", matchScore: 0.91 },
		{ id: "4", matchScore: 0.73 },
		{ id: "2", matchScore: 0.46 },
	],
	// God's Plan — Drake
	"6DCZcSspjsKoFjzjrWoCdn": [
		{ id: "4", matchScore: 0.88 },
		{ id: "6", matchScore: 0.57 },
		{ id: "2", matchScore: 0.38 },
	],
	// DtMF — Bad Bunny
	"3sK8wGT43QFpWrvNQsrQya": [
		{ id: "2", matchScore: 0.87 },
		{ id: "3", matchScore: 0.64 },
		{ id: "1", matchScore: 0.42 },
	],
	// That's So True — Gracie Abrams
	"7ne4VBA60CxGM75vw0EYad": [
		{ id: "3", matchScore: 0.9 },
		{ id: "1", matchScore: 0.71 },
		{ id: "5", matchScore: 0.48 },
	],
};

const PLAYLIST_BY_ID = new Map(DEMO_PLAYLISTS.map((p) => [p.id, p]));

const DEFAULT_TRACK_ID = "7lPN2DXiMsVn7XUKtOW1CS";

export function getDemoMatchesForSong(
	spotifyTrackId: string,
): DemoMatchPlaylist[] {
	const matches =
		DEMO_SONG_MATCHES[spotifyTrackId] ??
		DEMO_SONG_MATCHES[DEFAULT_TRACK_ID] ??
		[];
	return matches.map(({ id, matchScore }) => {
		const def = PLAYLIST_BY_ID.get(id);
		if (!def) return { id, name: "Unknown", reason: "", matchScore };
		return { id: def.id, name: def.name, reason: def.reason, matchScore };
	});
}
