import type { PlaylistSummary, PlaylistTrackVM } from "./types";

/**
 * Sample playlists + tracks for the exploration stories — real Spotify covers
 * and track names carried over from the lab so the layouts read like the live
 * app, not lorem. Not used in production; stories only.
 */

const T_MCE: PlaylistTrackVM[] = [
	{
		position: 1,
		name: "Last Nite",
		artists: ["The Strokes"],
		albumName: "Is This It",
		imageUrl:
			"https://i.scdn.co/image/ab67616d00001e0213f2466b83507515291acce4",
	},
	{
		position: 2,
		name: "Don't Start Now",
		artists: ["Dua Lipa"],
		albumName: "Future Nostalgia",
		imageUrl:
			"https://i.scdn.co/image/ab67616d00001e02c88bae7846e62a8ba59ee0bd",
	},
	{
		position: 3,
		name: "Training Season",
		artists: ["Dua Lipa"],
		albumName: "Radical Optimism",
		imageUrl:
			"https://i.scdn.co/image/ab67616d00001e022f8790ed72296c2614607575",
	},
	{
		position: 4,
		name: "Kill Bill",
		artists: ["SZA"],
		albumName: "SOS",
		imageUrl:
			"https://i.scdn.co/image/ab67616d00001e02bc18bdade69ec5ef0bb25b17",
	},
	{
		position: 5,
		name: "BIRDS OF A FEATHER",
		artists: ["Billie Eilish"],
		albumName: "HIT ME HARD AND SOFT",
		imageUrl:
			"https://i.scdn.co/image/ab67616d00001e0271d62ea7ea8a5be92d3c1f62",
	},
	{
		position: 6,
		name: "Bohemian Rhapsody",
		artists: ["Queen"],
		albumName: "A Night At The Opera",
		imageUrl:
			"https://i.scdn.co/image/ab67616d00001e02ce4f1737bc8a646c8c4bd25a",
	},
];

const T_DUBOLT: PlaylistTrackVM[] = [
	{
		position: 1,
		name: "Hilarity Duff",
		artists: ["KAYTRANADA"],
		albumName: "Hilarity Duff EP",
		imageUrl:
			"https://i.scdn.co/image/ab67616d00001e0270cd916cc7d895fb5e648a7f",
	},
	{
		position: 2,
		name: "Fair",
		artists: ["TEED"],
		albumName: "Trouble",
		imageUrl:
			"https://i.scdn.co/image/ab67616d00001e02ba02d709c8aeaf8ed0e80dc4",
	},
	{
		position: 3,
		name: "It's Good To Try",
		artists: ["Laurence Guy"],
		albumName: "Making Music Is Bad For Your Self Esteem",
		imageUrl:
			"https://i.scdn.co/image/ab67616d00001e02bda1c2e6f854b16df5f0b420",
	},
	{
		position: 4,
		name: "Sunday",
		artists: ["HNNY"],
		albumName: "Sunday",
		imageUrl:
			"https://i.scdn.co/image/ab67616d00001e02107d051e4c35ac3c8fe3470d",
	},
	{
		position: 5,
		name: "Jaded",
		artists: ["Lone"],
		albumName: "Reality Testing",
		imageUrl:
			"https://i.scdn.co/image/ab67616d00001e0258d3c41ece17b5a6ac257eda",
	},
	{
		position: 6,
		name: "BUS RIDE",
		artists: ["KAYTRANADA", "Karriem Riggins", "River Tiber"],
		albumName: "99.9%",
		imageUrl:
			"https://i.scdn.co/image/ab67616d00001e0242c18fe458181bc13d08070a",
	},
];

export const samplePlaylists: PlaylistSummary[] = [
	{
		id: "mce",
		name: "main character energy!!1!!",
		isTarget: true,
		songCount: 6,
		imageUrl:
			"https://mosaic.scdn.co/640/ab67616d00001e0213f2466b83507515291acce4ab67616d00001e022f8790ed72296c2614607575ab67616d00001e02bc18bdade69ec5ef0bb25b17ab67616d00001e02c88bae7846e62a8ba59ee0bd",
		intent: "a bit of insecurity in my mind about relationships",
		spotifyDescription:
			"songs that make me feel like the main character in my own movie! slay!!",
		genres: ["indie pop", "indie rock", "alternative"],
	},
	{
		id: "house",
		name: "house?",
		isTarget: true,
		songCount: 6,
		imageUrl:
			"https://mosaic.scdn.co/640/ab67616d00001e0203e3be2931712ce7c775b21eab67616d00001e022b89c8de96dcc7d5e05a48edab67616d00001e0237b51b1bfcf7028ef9e11bf1ab67616d00001e0268881375078c577509bb8681",
		intent: null,
		spotifyDescription: "AI: house music",
		genres: ["pop", "art pop", "baroque pop"],
	},
	{
		id: "sbsr",
		name: "Super Bock Super Rock 2021",
		isTarget: true,
		songCount: 14,
		imageUrl:
			"https://image-cdn-fa.spotifycdn.com/image/ab67706c0000da84c1975a91a3224aa534fc35ba",
		intent: null,
		spotifyDescription: "made with ♫ by @inotbeingf",
		genres: ["pop rock", "art rock", "rock", "alternative rock"],
	},
	{
		id: "dubolt",
		name: "Dubolt Mix: Kendrick Lamar / Ross from Friends / KAYTRANADA / Totally Enormous Extinct Dinosaurs / J. Cole",
		isTarget: true,
		songCount: 25,
		imageUrl:
			"https://mosaic.scdn.co/640/ab67616d00001e0201dbb413cc80ae630f1e66a3ab67616d00001e02107d051e4c35ac3c8fe3470dab67616d00001e02203f8c1682441cdd02d0fa85ab67616d00001e02d3e8d904b8b9beca4d33583e",
		intent: null,
		spotifyDescription: null,
		genres: [],
	},
	{
		id: "souvenir",
		name: "souvenir",
		isTarget: false,
		songCount: 0,
		imageUrl: null,
		intent: null,
		spotifyDescription: "my indie rock broken heart playlist",
		genres: [],
	},
	{
		id: "yilkes",
		name: "yilkes!",
		isTarget: false,
		songCount: 1,
		imageUrl:
			"https://i.scdn.co/image/ab67616d00001e02382514f0114ba8f4a16d5db4",
		intent: null,
		spotifyDescription: "songs i can't skip",
		genres: [],
	},
	{
		id: "jj",
		name: "jj",
		isTarget: false,
		songCount: 0,
		imageUrl: null,
		intent: null,
		spotifyDescription: "AI: songs that just get it",
		genres: [],
	},
	{
		id: "hello",
		name: "hello",
		isTarget: false,
		songCount: 0,
		imageUrl: null,
		intent: null,
		spotifyDescription: "AI: make it make sense bestie",
		genres: [],
	},
];

export const sampleTracks: Record<string, PlaylistTrackVM[]> = {
	mce: T_MCE,
	dubolt: T_DUBOLT,
};

export const TOP_GENRES = [
	"indie pop",
	"house",
	"disco",
	"soul",
	"ambient",
	"rock",
] as const;
