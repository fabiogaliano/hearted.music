export interface PlaylistV2RevisionContract {
	revision: string;
	[key: string]: unknown;
}

export interface PlaylistV2CreateContract extends PlaylistV2RevisionContract {
	uri: string;
}

// register-image returns the internal picture file-id that UPDATE_LIST_ATTRIBUTES
// then persists as the playlist cover.
export interface PlaylistV2RegisterImageContract {
	picture: string;
}

// image-upload.spotify.com/v4/playlist returns an opaque token referencing the
// just-uploaded bytes, consumed by the subsequent register-image call.
export interface ImageUploadContract {
	uploadToken: string;
}
