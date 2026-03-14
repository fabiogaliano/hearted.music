// Referents Response
export interface Meta {
	status: number;
}

export interface ResponseReferentsRange {
	content: string;
}

export interface ResponseReferentsAnnotatableClientTimestamps {
	updated_by_human_at: number;
	lyrics_updated_at: number;
}

export interface ResponseReferentsAnnotatable {
	api_path: string;
	client_timestamps: ResponseReferentsAnnotatableClientTimestamps;
	context: string;
	id: number;
	image_url: string;
	link_title: string;
	title: string;
	type: string;
	url: string;
}

export interface ResponseReferentsAnnotationsBodyDomChildren {
	tag: string;
	children: string[];
}

export interface ResponseReferentsAnnotationsBodyDom {
	tag: string;
	children: ResponseReferentsAnnotationsBodyDomChildren[];
}

export interface ResponseReferentsAnnotationsBody {
	plain: string;
}

export interface ResponseReferentsAnnotationsCurrentUserMetadataInteractions {
	cosign: boolean;
	pyong: boolean;
	vote?: unknown;
}

export interface ResponseReferentsAnnotationsCurrentUserMetadata {
	permissions?: unknown[];
	excluded_permissions: string[];
	interactions: ResponseReferentsAnnotationsCurrentUserMetadataInteractions;
	iq_by_action: object;
}

export interface ResponseReferentsAnnotationsAuthorsUserAvatarTinyBoundingBox {
	width: number;
	height: number;
}

export interface ResponseReferentsAnnotationsAuthorsUserAvatarTiny {
	url: string;
	bounding_box: ResponseReferentsAnnotationsAuthorsUserAvatarTinyBoundingBox;
}

export interface ResponseReferentsAnnotationsAuthorsUserAvatar {
	tiny: ResponseReferentsAnnotationsAuthorsUserAvatarTiny;
	thumb: ResponseReferentsAnnotationsAuthorsUserAvatarTiny;
	small: ResponseReferentsAnnotationsAuthorsUserAvatarTiny;
	medium: ResponseReferentsAnnotationsAuthorsUserAvatarTiny;
}

export interface ResponseReferentsAnnotationsAuthorsUserCurrentUserMetadataInteractions {
	following: boolean;
}

export interface ResponseReferentsAnnotationsAuthorsUserCurrentUserMetadata {
	permissions?: unknown[];
	excluded_permissions: string[];
	interactions: ResponseReferentsAnnotationsAuthorsUserCurrentUserMetadataInteractions;
}

export interface ResponseReferentsAnnotationsAuthorsUser {
	api_path: string;
	avatar: ResponseReferentsAnnotationsAuthorsUserAvatar;
	header_image_url: string;
	human_readable_role_for_display: string;
	id: number;
	iq: number;
	login: string;
	name: string;
	role_for_display: string;
	url: string;
	current_user_metadata: ResponseReferentsAnnotationsAuthorsUserCurrentUserMetadata;
}

export interface ResponseReferentsAnnotationsAuthors {
	attribution: number;
	pinned_role: string;
	user: ResponseReferentsAnnotationsAuthorsUser;
}

export interface ResponseReferentsAnnotations {
	api_path: string;
	body: ResponseReferentsAnnotationsBody;
	comment_count: number;
	community: boolean;
	custom_preview?: unknown;
	has_voters: boolean;
	id: number;
	pinned: boolean;
	share_url: string;
	source?: unknown;
	state: string;
	url: string;
	verified: boolean;
	votes_total: number;
	current_user_metadata: ResponseReferentsAnnotationsCurrentUserMetadata;
	authors: ResponseReferentsAnnotationsAuthors[];
	cosigned_by?: unknown[];
	rejection_comment?: unknown;
	verified_by: ResponseReferentsAnnotationsAuthorsUser;
}

export interface ResponseReferents {
	_type: string;
	annotator_id: number;
	annotator_login: string;
	api_path: string;
	classification: string;
	fragment: string;
	id: number;
	is_description: boolean;
	path: string;
	range: ResponseReferentsRange;
	song_id: number;
	url: string;
	verified_annotator_ids?: unknown[];
	annotatable: ResponseReferentsAnnotatable;
	annotations: ResponseReferentsAnnotations[];
}

export interface Response {
	referents: ResponseReferents[];
}

export interface ResponseReferents {
	meta: Meta;
	response: Response;
}

// Search Response
export interface Meta {
	status: number;
}

export interface ResponseHitsResultReleaseDateComponents {
	year: number;
	month: number;
	day: number;
}

export interface ResponseHitsResultStats {
	unreviewed_annotations: number;
	hot: boolean;
	pageviews: number;
}

export interface ResponseHitsResultFeaturedArtists {
	api_path: string;
	header_image_url: string;
	id: number;
	image_url: string;
	is_meme_verified: boolean;
	is_verified: boolean;
	name: string;
	url: string;
}

export interface ResponseHitsResultPrimaryArtist {
	api_path: string;
	header_image_url: string;
	id: number;
	image_url: string;
	is_meme_verified: boolean;
	is_verified: boolean;
	name: string;
	url: string;
	iq: number;
}

export interface ResponseHitsResult {
	annotation_count: number;
	api_path: string;
	artist_names: string;
	full_title: string;
	header_image_thumbnail_url: string;
	header_image_url: string;
	id: number;
	lyrics_owner_id: number;
	lyrics_state: string;
	path: string;
	primary_artist_names: string;
	pyongs_count: number;
	relationships_index_url: string;
	release_date_components: ResponseHitsResultReleaseDateComponents;
	release_date_for_display: string;
	release_date_with_abbreviated_month_for_display: string;
	song_art_image_thumbnail_url: string;
	song_art_image_url: string;
	stats: ResponseHitsResultStats;
	title: string;
	title_with_featured: string;
	url: string;
	featured_artists: ResponseHitsResultFeaturedArtists[];
	primary_artist: ResponseHitsResultPrimaryArtist;
	primary_artists: ResponseHitsResultPrimaryArtist[];
}

export interface ResponseHits {
	highlights?: unknown[];
	index: string;
	type: string;
	result: ResponseHitsResult;
}

export interface Response {
	hits: ResponseHits[];
}

export interface SearchResponse {
	meta: Meta;
	response: Response;
}
