export interface GetTrack {
	data: {
		trackUnion: TrackUnion;
	};
}

export interface TrackUnion {
	__typename: string;
	id: string;
	uri: string;
	name: string;
	duration: { totalMilliseconds: number };
	trackNumber: number;
	mediaType: string;
	playcount: string;
	contentRating: { label: string };
	playability: { playable: boolean; reason: string };
	saved: boolean;
	sharingInfo: { shareId: string; shareUrl: string };
	albumOfTrack: AlbumOfTrack;
	firstArtist: { items: TrackArtist[] };
	otherArtists: { items: TrackArtist[] };
}

export interface AlbumOfTrack {
	id: string;
	uri: string;
	name: string;
	date: { isoString: string; precision: string; year: number };
	coverArt: {
		sources: Array<{ url: string; width: number; height: number }>;
	};
	copyright: {
		items: Array<{ text: string; type: string }>;
		totalCount: number;
	};
}

export interface TrackArtist {
	id: string;
	uri: string;
	profile: { name: string };
}
