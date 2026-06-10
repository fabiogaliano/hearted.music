export interface PlaylistV2RevisionContract {
	revision: string;
	[key: string]: unknown;
}

export interface PlaylistV2CreateContract extends PlaylistV2RevisionContract {
	uri: string;
}
