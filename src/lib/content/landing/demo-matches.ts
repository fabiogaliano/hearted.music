/**
 * Static demo playlist match data for the landing page and onboarding demo.
 * These are hand-curated matches — no DB rows involved.
 */

export interface DemoPlaylist {
	id: string;
	name: string;
	/** A short "what this playlist is for" blurb. Not shown as a pre-filled intent
	 * in the flag-playlists preview (playlists start blank there), but kept so
	 * Phase 4 can reuse these strings as ready-made intent examples. */
	reason: string;
	/** Cover served from /public/demo-playlists; omitted → the ♫ placeholder. */
	imageUrl?: string;
}

interface DemoSongMatch {
	id: string;
	matchScore: number;
}

interface DemoMatchPlaylist {
	id: string;
	spotifyId: string;
	name: string;
	reason: string;
	matchScore: number;
}

export const DEMO_PLAYLISTS: readonly DemoPlaylist[] = [
	{
		id: "1",
		name: "crying in the car",
		reason: "for when you're driving and it hits you",
		imageUrl: "/demo-playlists/crying-in-the-car.webp",
	},
	{
		id: "2",
		name: "golden hour bike ride",
		reason: "movement that feels good",
		imageUrl: "/demo-playlists/biking-sunset-city.webp",
	},
	{
		id: "3",
		name: "feeling everything",
		reason: "songs that meet you where you are",
		imageUrl: "/demo-playlists/feeling-everything.webp",
	},
	{
		id: "4",
		name: "main character energy",
		reason: "when you need to feel like the point",
		imageUrl: "/demo-playlists/main-character-energy.webp",
	},
	{
		id: "5",
		name: "3am thoughts",
		reason: "the spiral, but make it beautiful",
		imageUrl: "/demo-playlists/3am-thoughts.webp",
	},
	{
		id: "6",
		name: "sunday softness",
		reason: "no urgency, just warmth",
		imageUrl: "/demo-playlists/sunday-softness.webp",
	},
	{
		id: "7",
		name: "revenge era",
		reason: "when done-with-it becomes a superpower",
		imageUrl: "/demo-playlists/revenge-era.webp",
	},
] as const;

// Hand-tuned demo matches: each song scored against the playlists' intent
// descriptions (the mood/scene/sonic cues in demo-intent-examples.ts), not just
// the titles — so a song lands in several playlists at different strengths and
// off-vibe pairings drop out. Playlist ids: 1 crying in the car · 2 golden hour
// bike ride · 3 feeling everything · 4 main character energy · 5 3am thoughts ·
// 6 sunday softness · 7 revenge era. Scores descend within each song.
const DEMO_SONG_MATCHES: Record<string, DemoSongMatch[]> = {
	// Ribs — Lorde · nostalgic dread of growing up, building synths, the panic of
	// feeling it all at once
	"2MvvoeRt8NcOXWESkxWn3g": [
		{ id: "3", matchScore: 0.92 },
		{ id: "5", matchScore: 0.74 },
		{ id: "1", matchScore: 0.55 },
	],
	// Houdini — Dua Lipa · confident disco-pop strut, daring someone to keep up
	"4OMJGnvZfDvsePyCwRGO7X": [
		{ id: "4", matchScore: 0.9 },
		{ id: "2", matchScore: 0.7 },
		{ id: "7", matchScore: 0.55 },
	],
	// Thinkin Bout You — Frank Ocean · hushed falsetto, late-night intimate longing
	"7DfFc7a6Rwfi3YQMRbDMau": [
		{ id: "5", matchScore: 0.91 },
		{ id: "3", matchScore: 0.7 },
		{ id: "1", matchScore: 0.55 },
	],
	// Motion Sickness — Phoebe Bridgers · wry, aching breakup, the classic car-cry
	"5xo8RrjJ9CVNrtRg2S3B1R": [
		{ id: "1", matchScore: 0.95 },
		{ id: "3", matchScore: 0.78 },
		{ id: "7", matchScore: 0.52 },
	],
	// Too Sweet — Hozier · warm bluesy groove, easy and unhurried
	"3HMY0r2BAdpasXMY8rseR0": [
		{ id: "2", matchScore: 0.88 },
		{ id: "6", matchScore: 0.66 },
		{ id: "3", matchScore: 0.48 },
	],
	// Do I Wanna Know? — Arctic Monkeys · brooding 3am riff, sleepless yearning
	"5FVd6KXrgO9B3JPmC8OPst": [
		{ id: "5", matchScore: 0.9 },
		{ id: "7", matchScore: 0.6 },
		{ id: "4", matchScore: 0.5 },
	],
	// Kill Bill — SZA · smooth, deadpan revenge fantasy
	"1Qrg8KqiBpW07V7PNxwwwL": [
		{ id: "7", matchScore: 0.93 },
		{ id: "5", matchScore: 0.7 },
		{ id: "3", matchScore: 0.5 },
	],
	// Not Like Us — Kendrick Lamar · dominant diss, owning the room
	"6AI3ezQ4o3HUoP6Dhudph3": [
		{ id: "4", matchScore: 0.93 },
		{ id: "7", matchScore: 0.85 },
	],
	// Taxes — Geese · raw, rootsy indie-rock build
	"7r9BUOSnekEjrkMhmxD6Ae": [
		{ id: "3", matchScore: 0.76 },
		{ id: "1", matchScore: 0.58 },
		{ id: "6", matchScore: 0.48 },
	],
	// Beautiful Things — Benson Boone · soft-to-explosive, grateful and terrified
	"6tNQ70jh4OwmPGpYy6R2o9": [
		{ id: "3", matchScore: 0.92 },
		{ id: "1", matchScore: 0.66 },
		{ id: "6", matchScore: 0.5 },
	],
	// BIRDS OF A FEATHER — Billie Eilish · soft, devoted, gentle warmth
	"6dOtVTDdiauQNBQEDOtlAB": [
		{ id: "6", matchScore: 0.82 },
		{ id: "3", matchScore: 0.78 },
		{ id: "2", matchScore: 0.66 },
	],
	// drivers license — Olivia Rodrigo · the definitive car-cry breakup ballad
	"7lPN2DXiMsVn7XUKtOW1CS": [
		{ id: "1", matchScore: 0.97 },
		{ id: "3", matchScore: 0.8 },
		{ id: "5", matchScore: 0.6 },
	],
	// Pink Pony Club — Chappell Roan · euphoric, liberating, becoming yourself
	"1k2pQc5i348DCHwbn5KTdc": [
		{ id: "4", matchScore: 0.9 },
		{ id: "2", matchScore: 0.76 },
		{ id: "7", matchScore: 0.55 },
	],
	// EARFQUAKE — Tyler, the Creator · lush, vulnerable plea
	"5hVghJ4KaYES3BFUATCYn0": [
		{ id: "3", matchScore: 0.85 },
		{ id: "5", matchScore: 0.7 },
		{ id: "1", matchScore: 0.58 },
	],
	// Blinding Lights — The Weeknd · propulsive 80s-synth night drive
	"0VjIjW4GlUZAMYd2vXMi3b": [
		{ id: "4", matchScore: 0.85 },
		{ id: "2", matchScore: 0.72 },
		{ id: "5", matchScore: 0.55 },
	],
	// As It Was — Harry Styles · bright synthpop carrying real melancholy
	"4Dvkj6JhhA12EX05fT7y2e": [
		{ id: "3", matchScore: 0.8 },
		{ id: "2", matchScore: 0.72 },
		{ id: "1", matchScore: 0.5 },
	],
	// Manchild — Sabrina Carpenter · sassy, witty kiss-off
	"42UBPzRMh5yyz0EDPr6fr1": [
		{ id: "7", matchScore: 0.9 },
		{ id: "4", matchScore: 0.72 },
		{ id: "2", matchScore: 0.5 },
	],
	// God's Plan — Drake · warm, grateful, proving the doubters wrong
	"6DCZcSspjsKoFjzjrWoCdn": [
		{ id: "4", matchScore: 0.82 },
		{ id: "7", matchScore: 0.6 },
		{ id: "2", matchScore: 0.48 },
	],
	// DtMF — Bad Bunny · bittersweet nostalgia, warm and communal
	"3sK8wGT43QFpWrvNQsrQya": [
		{ id: "3", matchScore: 0.8 },
		{ id: "2", matchScore: 0.72 },
		{ id: "6", matchScore: 0.55 },
	],
	// That's So True — Gracie Abrams · snappy, knowing post-breakup pettiness
	"7ne4VBA60CxGM75vw0EYad": [
		{ id: "1", matchScore: 0.78 },
		{ id: "3", matchScore: 0.7 },
		{ id: "7", matchScore: 0.62 },
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
		if (!def)
			return { id, spotifyId: "", name: "Unknown", reason: "", matchScore };
		return {
			id: def.id,
			spotifyId: "",
			name: def.name,
			reason: def.reason,
			matchScore,
		};
	});
}
