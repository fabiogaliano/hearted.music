import type { HubData, MatchPreviewVM, PlaylistVM, SongVM } from "./types";

const cover = (seed: string) => `https://picsum.photos/seed/${seed}/300/300`;

export const MATCH_PREVIEWS: MatchPreviewVM[] = [
	{
		id: 1,
		image: cover("stranger-in-the-alps"),
		name: "Motion Sickness",
		artist: "Phoebe Bridgers",
	},
	{ id: 2, image: cover("blonde-ocean"), name: "Ivy", artist: "Frank Ocean" },
	{
		id: 3,
		image: cover("melodrama-blue"),
		name: "The Louvre",
		artist: "Lorde",
	},
];

export const RECENT_SONGS: SongVM[] = [
	{
		id: "s1",
		title: "Motion Sickness",
		artist: "Phoebe Bridgers",
		coverUrl: cover("stranger-in-the-alps"),
		likedAgo: "2h ago",
	},
	{
		id: "s2",
		title: "Apocalypse",
		artist: "Cigarettes After Sex",
		coverUrl: cover("cas-apocalypse"),
		likedAgo: "yesterday",
	},
	{
		id: "s3",
		title: "Vienna",
		artist: "Billy Joel",
		coverUrl: cover("the-stranger-77"),
		likedAgo: "3d ago",
	},
];

export const PLAYLISTS: PlaylistVM[] = [
	{
		id: "p1",
		name: "late night drives",
		coverUrl: cover("late-night-drives"),
		trackCount: 42,
	},
	{
		id: "p2",
		name: "kitchen dancing",
		coverUrl: cover("kitchen-dancing"),
		trackCount: 28,
	},
	{
		id: "p3",
		name: "rainy focus",
		coverUrl: cover("rainy-focus"),
		trackCount: 63,
	},
	{
		id: "p4",
		name: "sunday reset",
		coverUrl: cover("sunday-reset"),
		trackCount: 19,
	},
	{
		id: "p5",
		name: "golden hour",
		coverUrl: cover("golden-hour-pl"),
		trackCount: 35,
	},
];

export function makeHubData(matchCount: number): HubData {
	return {
		handle: "june",
		planLabel: "Free plan",
		matchCount,
		matchPreviews: MATCH_PREVIEWS.slice(0, Math.min(matchCount, 3)),
		likedCount: 1204,
		recentSongs: RECENT_SONGS,
		playlistCount: 18,
		playlists: PLAYLISTS,
	};
}
