export interface FetchPlaylistContents {
	data: FetchPlaylistContentsData;
}

export interface FetchPlaylistContentsData {
	playlistV2: PlaylistV2;
}

export interface PlaylistV2 {
	__typename: string;
	content: Content;
}

export interface Content {
	__typename: string;
	items: ContentItem[];
	pagingInfo: PagingInfo;
	totalCount: number;
}

export interface ContentItem {
	addedAt: AddedAt;
	addedBy: AddedBy | null;
	attributes: any[];
	itemV2: ItemV2;
	itemV3: ItemV3;
	uid: string;
}

export interface AddedAt {
	isoString: string;
}

export interface AddedBy {
	data: AddedByData | null;
}

export interface AddedByData {
	__typename: string;
	avatar: Avatar | null;
	name: string;
	uri: string;
	username: string;
}

export interface Avatar {
	sources: AvatarSource[];
}

export interface AvatarSource {
	height: number;
	url: string;
	width: number;
}

export interface ItemV2 {
	__typename: string;
	data: ItemV2Data;
}

export interface ItemV2Data {
	__typename: string;
	albumOfTrack: AlbumOfTrack;
	artists: Artists;
	associationsV3: AssociationsV3;
	contentRating: ContentRating;
	discNumber: number;
	trackDuration: TrackDuration;
	mediaType: string;
	name: string;
	playability: Playability;
	playcount: string;
	trackNumber: number;
	uri: string;
}

export interface AlbumOfTrack {
	artists: Artists;
	coverArt: Avatar;
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

export interface AssociationsV3 {
	audioAssociations: AudioAssociations;
	videoAssociations: VideoAssociations;
}

export interface AudioAssociations {
	__typename: string;
	items: any[];
}

export interface VideoAssociations {
	totalCount: number;
}

export interface ContentRating {
	label: string;
}

export interface Playability {
	playable: boolean;
	reason: string;
}

export interface TrackDuration {
	totalMilliseconds: number;
}

export interface ItemV3 {
	__typename: string;
	data: ItemV3Data;
}

export interface ItemV3Data {
	__typename: string;
	consumptionExperienceTrait: ConsumptionExperienceTrait;
	identityTrait: DataIdentityTrait;
	uri: string;
	visualIdentityTrait: VisualIdentityTrait;
}

export interface ConsumptionExperienceTrait {
	__typename: string;
	contentRatings: any[];
	duration: Duration;
}

export interface Duration {
	nanoSeconds: number;
	seconds: number;
}

export interface DataIdentityTrait {
	__typename: string;
	contentHierarchyParent: ContentHierarchyParent;
	contributors: Contributors;
	description: string;
	name: string;
	type: string;
}

export interface ContentHierarchyParent {
	__typename: string;
	identityTrait: ContentHierarchyParentIdentityTrait;
	publishingMetadataTrait: PublishingMetadataTrait;
	uri: string;
}

export interface ContentHierarchyParentIdentityTrait {
	__typename: string;
	name: string;
}

export interface PublishingMetadataTrait {
	__typename: string;
	firstPublishedAt: FirstPublishedAt;
}

export interface FirstPublishedAt {
	isoString: string;
	precision: string;
}

export interface Contributors {
	items: ContributorsItem[];
	totalCount: number;
}

export interface ContributorsItem {
	name: string;
	uri: string;
}

export interface VisualIdentityTrait {
	__typename: string;
	sixteenByNineCoverImage: { image: Image } | null;
	squareCoverImage: SquareCoverImage;
}

export interface SquareCoverImage {
	extractedColorSet: ExtractedColorSet;
	image: Image;
}

export interface ExtractedColorSet {
	encoreBaseSetTextColor: EncoreBaseSetTextColor;
	highContrast: Contrast;
	higherContrast: Contrast;
	minContrast: Contrast;
}

export interface EncoreBaseSetTextColor {
	alpha: number;
	blue: number;
	green: number;
	red: number;
}

export interface Contrast {
	backgroundBase: EncoreBaseSetTextColor;
	backgroundTintedBase: EncoreBaseSetTextColor;
	textBase: EncoreBaseSetTextColor;
	textBrightAccent: EncoreBaseSetTextColor;
	textSubdued: EncoreBaseSetTextColor;
}

export interface Image {
	data: ImageData;
}

export interface ImageData {
	__typename: string;
	sources: DataSource[];
}

export interface DataSource {
	imageFormat: string;
	maxHeight: number;
	maxWidth: number;
	url: string;
}

export interface PagingInfo {
	limit: number;
	offset: number;
}
