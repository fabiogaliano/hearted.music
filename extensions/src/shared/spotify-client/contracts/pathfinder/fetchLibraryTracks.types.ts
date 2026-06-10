export interface FetchLibraryTracks {
	data: FetchLibraryTracksData;
}

export interface FetchLibraryTracksData {
	me: Me;
}

export interface Me {
	library: Library;
}

export interface Library {
	tracks: Tracks;
}

export interface Tracks {
	__typename: string;
	items: TracksItem[];
	pagingInfo: PagingInfo;
	totalCount: number;
}

export interface TracksItem {
	__typename: string;
	addedAt: AddedAt;
	track: Track;
}

export interface AddedAt {
	isoString: string;
}

export interface Track {
	_uri: string;
	data: TrackData;
}

export interface TrackData {
	__typename: string;
	albumOfTrack: AlbumOfTrack;
	artists: Artists;
	associationsV3: AssociationsV3;
	contentRating: ContentRating;
	discNumber: number;
	duration: Duration;
	mediaType: string;
	name: string;
	playability: Playability;
	trackNumber: number;
}

export interface AlbumOfTrack {
	artists: Artists;
	coverArt: CoverArt;
	name: string;
	uri: string;
}

export interface Artists {
	items: ArtistsItem[];
}

export interface ArtistsItem {
	profile: Profile;
	uri: string;
}

export interface Profile {
	name: string;
}

export interface CoverArt {
	sources: Source[];
}

export interface Source {
	height: number;
	url: string;
	width: number;
}

export interface AssociationsV3 {
	audioAssociations: OAssociations;
	videoAssociations: OAssociations;
}

export interface OAssociations {
	totalCount: number;
}

export interface ContentRating {
	label: string;
}

export interface Duration {
	totalMilliseconds: number;
}

export interface Playability {
	playable: boolean;
}

export interface PagingInfo {
	limit: number;
	offset: number;
}
