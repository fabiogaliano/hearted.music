/**
 * Test fixtures with real data from Spotify account kapran0s (fabiogaliano)
 */

import type { SimplifiedPlaylist } from "@fostertheweb/spotify-web-sdk";
import type { SpotifyPlaylistDTO } from "@/lib/integrations/spotify/service";

export const TEST_ACCOUNT = {
	id: "11111111-1111-1111-1111-111111111111",
	spotify_id: "olivertsubasa",
	display_name: "oliver",
} as const;

export const PLAYLISTS = {
	lofiCityPop: {
		id: "76fe1eaa-ab80-4419-9f58-bacc5a95fb96",
		spotify_id: "5XCezTRDW3RSBfAtZqEVRR",
		name: "作業・勉強用 / lo-fi tokyo City Pop",
		description:
			"作業・勉強用 / Lo-Fi tokyo City Pop, テラスハウス by @_K__T____",
		is_destination: false,
		song_count: 1136,
		image_url:
			"https://image-cdn-fa.spotifycdn.com/image/ab67706c0000da8451ff2030389ee2791a89a616",
	},
	likedForAnna: {
		id: "77ceed7a-f152-4470-b8a2-315bbac093c2",
		spotify_id: "2xxuGkB7fld589tVd03L7L",
		name: "liked songs public for anna.",
		description: "",
		is_destination: false,
		song_count: 616,
		image_url:
			"https://mosaic.scdn.co/640/ab67616d00001e027ac9593478963cbbe6f47277ab67616d00001e028c697f553a46006a5d8886b2ab67616d00001e0296b331e479adacf1ca778c2cab67616d00001e02bbd45c8d36e0e045ef640411",
	},
	oldRock: {
		id: "fa41a28c-6c12-49c6-9e49-bc57a1ac05d3",
		spotify_id: "5W7E0pC3pc0AXJTUchYFk7",
		name: "old rock - coding zone",
		description: "",
		is_destination: false,
		song_count: 507,
		image_url:
			"https://mosaic.scdn.co/640/ab67616d00001e0251136aeb3f6b077a3f9d9a0fab67616d00001e025d11c2fe73a7d376d3b06107ab67616d00001e026e042c39906a7c7d49b67b91ab67616d00001e02dc30583ba717007b00cceb25",
	},
	years2009to2013: {
		id: "68801aac-e249-4676-882b-bcbded5be083",
		spotify_id: "6P0Jk3KKbCC4mtkbbUounl",
		name: "2009~2013",
		description: "",
		is_destination: true,
		song_count: 244,
		image_url:
			"https://mosaic.scdn.co/640/ab67616d00001e021488c6ffb241dc6306581a2eab67616d00001e02c7d00568db33ae806cfdcbdfab67616d00001e02e198b6b9c5bfe013458e8ec9ab67616d00001e02e9a18c4792e88f34bd17bbaf",
	},
	focus: {
		id: "af5dbf8a-58c4-448f-80ff-8455878a2acd",
		spotify_id: "4VbX8XosHo1ZeqjknJnNMf",
		name: "focus - v2",
		description: "",
		is_destination: false,
		song_count: 202,
		image_url:
			"https://mosaic.scdn.co/640/ab67616d00001e02014080d39d56c94c0b285362ab67616d00001e022057743ed6bf8bd21f5e68f2ab67616d00001e02b35037d0dedbd9f7d8e26fe8ab67616d00001e02d87ab9da3347b385930734aa",
	},
} as const;

export const SONGS = {
	dontHurtMe: {
		id: "842b79b4-d0ab-4f5c-a49e-c0b5d8eb70f0",
		spotify_id: "5GIkGcmKJNVmwjntP85GTS",
		name: "Don't Hurt Me, I'm Trying",
		artists: ["NoSo"],
		album_name: "Nara",
		duration_ms: 183000,
		image_url:
			"https://i.scdn.co/image/ab67616d0000b273a0528382229c84aae80a14d6",
	},
	electricFish: {
		id: "f243c442-965c-4b24-b82d-afb3e5a0ed34",
		spotify_id: "2i90BhQ6Mfvrd8yHRTHyZx",
		name: "Electric Fish",
		artists: ["Ana Frango Elétrico"],
		album_name: "Me Chama De Gato Que Eu Sou Sua",
		duration_ms: 252959,
		image_url:
			"https://i.scdn.co/image/ab67616d0000b273dfa82523de5ab6b5508d7aa5",
	},
	goneBaby: {
		id: "3502cebe-2f49-4c67-a09c-16d3aa0aa5ba",
		spotify_id: "0QQDaKW7eRRoqvbLCylzrn",
		name: "Gone Baby, Don't Be Long",
		artists: ["Erykah Badu"],
		album_name: "New Amerykah Part Two: Return Of The Ankh",
		duration_ms: 279720,
		image_url:
			"https://i.scdn.co/image/ab67616d0000b2732c1b088d399087bd3a1de30b",
	},
	whatIsLove: {
		id: "96568357-6b84-4f99-9f7b-2b4e72b58edf",
		spotify_id: "1IX47gefluXmKX4PrTBCRM",
		name: "What is Love",
		artists: ["TWICE"],
		album_name: "Summer Nights",
		duration_ms: 208240,
		image_url:
			"https://i.scdn.co/image/ab67616d0000b273d72bea64eca7f26647f8e57a",
	},
	fancy: {
		id: "fcfb0332-8be6-4a43-b507-1a59a2414271",
		spotify_id: "0W5hTAWn8Tq0Qfhg1XP3YW",
		name: "FANCY",
		artists: ["TWICE"],
		album_name: "FANCY YOU",
		duration_ms: 213880,
		image_url:
			"https://i.scdn.co/image/ab67616d0000b2739e87fd81ab0dfad228f8a004",
	},
	theWave: {
		id: "ab1d9194-9e06-4f15-87a6-1169986c8409",
		spotify_id: "1hbmFI3DdGqFJn4wnrQlF4",
		name: "The Wave",
		artists: ["SE SO NEON"],
		album_name: "The Wave",
		duration_ms: 282453,
		image_url:
			"https://i.scdn.co/image/ab67616d0000b27301286474faacf2334695f99f",
	},
	lifeWillBe: {
		id: "4abfa0d0-5445-43ca-ac36-f8c7890ad7da",
		spotify_id: "4ZTC6KvnQxloiwmT0Yhypy",
		name: "Life Will Be",
		artists: ["Cleo Sol"],
		album_name: "Gold",
		duration_ms: 198200,
		image_url:
			"https://i.scdn.co/image/ab67616d0000b2738128b3a01e0246795dfab1a2",
	},
	go: {
		id: "ab296904-b32f-445f-a0b0-2efa34911275",
		spotify_id: "4JNTpbntShpUpACDUzwHV5",
		name: "GO!",
		artists: ["Common"],
		album_name: "Be",
		duration_ms: 224160,
		image_url:
			"https://i.scdn.co/image/ab67616d0000b2736c1e31e10c7a5b2ed2258e29",
	},
	fallInLove: {
		id: "54788aa5-9ca8-4f64-9551-d8e6c1297700",
		spotify_id: "5imUTBF35uIoABlV9g9da2",
		name: "Fall In Love",
		artists: ["Phantogram"],
		album_name: "Voices",
		duration_ms: 223226,
		image_url:
			"https://i.scdn.co/image/ab67616d0000b2734a02353678a4f62a9d2e3d2b",
	},
} as const;

export const ALL_PLAYLISTS = Object.values(PLAYLISTS);
export const ALL_SONGS = Object.values(SONGS);

export interface OnboardingPlaylist {
	id: string;
	name: string;
	description: string | null;
	imageUrl: string | null;
	songCount: number | null;
	isDestination: boolean;
}

type PlaylistFixture = (typeof PLAYLISTS)[keyof typeof PLAYLISTS];

export function toOnboardingPlaylist(
	playlist: PlaylistFixture,
	overrides?: Partial<OnboardingPlaylist>,
): OnboardingPlaylist {
	return {
		id: playlist.id,
		name: playlist.name,
		description: playlist.description || null,
		imageUrl: playlist.image_url,
		songCount: playlist.song_count,
		isDestination: playlist.is_destination,
		...overrides,
	};
}

export const ONBOARDING_PLAYLISTS = {
	lofiCityPop: toOnboardingPlaylist(PLAYLISTS.lofiCityPop),
	likedForAnna: toOnboardingPlaylist(PLAYLISTS.likedForAnna),
	oldRock: toOnboardingPlaylist(PLAYLISTS.oldRock),
	years2009to2013: toOnboardingPlaylist(PLAYLISTS.years2009to2013),
	focus: toOnboardingPlaylist(PLAYLISTS.focus),
} as const;

export const ALL_ONBOARDING_PLAYLISTS = Object.values(ONBOARDING_PLAYLISTS);

type SongFixture = (typeof SONGS)[keyof typeof SONGS];

export interface SpotifyApiSavedTrack {
	added_at: string;
	track: {
		id: string;
		name: string;
		artists: Array<{ id: string; name: string }>;
		album: {
			id: string;
			name: string;
			images: Array<{ url: string; width: number; height: number }>;
		};
		duration_ms: number;
		uri: string;
	};
}

export function toSpotifyApiSavedTrack(
	song: SongFixture,
	addedAt: string,
): SpotifyApiSavedTrack {
	return {
		added_at: addedAt,
		track: {
			id: song.spotify_id,
			name: song.name,
			artists: song.artists.map((name, i) => ({
				id: `artist-${song.spotify_id}-${i}`,
				name,
			})),
			album: {
				id: `album-${song.spotify_id}`,
				name: song.album_name,
				images: [{ url: song.image_url, width: 300, height: 300 }],
			},
			duration_ms: song.duration_ms,
			uri: `spotify:track:${song.spotify_id}`,
		},
	};
}

export type SpotifyApiPlaylist = Pick<
	SimplifiedPlaylist,
	"id" | "name" | "description" | "owner" | "images"
> & {
	tracks: { total: number };
};

export function toSpotifyApiPlaylist(
	playlist: PlaylistFixture,
	ownerId: string,
): SpotifyApiPlaylist {
	return {
		id: playlist.spotify_id,
		name: playlist.name,
		description: playlist.description || null,
		owner: { id: ownerId },
		tracks: { total: playlist.song_count },
		images: playlist.image_url ? [{ url: playlist.image_url }] : null,
	} as SpotifyApiPlaylist;
}

export function toSpotifyPlaylistDTO(
	playlist: PlaylistFixture,
	ownerId: string,
): SpotifyPlaylistDTO {
	return {
		id: playlist.spotify_id,
		name: playlist.name,
		description: playlist.description || null,
		owner: { id: ownerId },
		track_count: playlist.song_count,
		image_url: playlist.image_url,
	};
}
