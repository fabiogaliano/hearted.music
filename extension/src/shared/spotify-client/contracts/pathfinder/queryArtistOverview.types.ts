export interface QueryArtistOverview {
	data: QueryArtistOverviewData;
}

export interface QueryArtistOverviewData {
	artistUnion: ArtistUnion;
}

export interface ArtistUnion {
	__typename: string;
	discography: Discography;
	goods: Goods;
	headerImage: HeaderImage;
	id: string;
	preRelease: null;
	profile: ArtistUnionProfile;
	relatedContent: RelatedContent;
	relatedMusicVideos: EdMusicVideos;
	saved: boolean;
	sharingInfo: SharingInfo;
	stats: Stats;
	unmappedMusicVideos: EdMusicVideos;
	uri: string;
	visualIdentity: VisualIdentity;
	visuals: ArtistUnionVisuals;
	watchFeedEntrypoint: WatchFeedEntrypoint | null;
}

export interface Discography {
	albums: Albums;
	compilations: Albums;
	latest: null;
	popularReleasesAlbums: PopularReleasesAlbums;
	singles: Albums;
	topTracks: TopTracks;
}

export interface Albums {
	items: AlbumsItem[];
	totalCount: number;
}

export interface AlbumsItem {
	releases: Merch;
}

export interface Merch {
	items: MerchItem[];
}

export interface MerchItem {
	copyright: Copyright;
	coverArt: CoverArtElement;
	date: PurpleDate;
	id: string;
	label: string;
	name: string;
	playability: Playability;
	sharingInfo: SharingInfo;
	tracks: Tracks;
	type: PurpleType;
	uri: string;
}

export interface Copyright {
	items: Biography[];
}

export interface Biography {
	text: string;
	type: BiographyType;
}

export enum BiographyType {
	Autobiography = "AUTOBIOGRAPHY",
	C = "C",
	P = "P",
}

export interface CoverArtElement {
	sources: ItemSource[];
}

export interface ItemSource {
	height: number | null;
	url: string;
	width: number | null;
}

export interface PurpleDate {
	day: number;
	month: number;
	precision: Precision;
	year: number;
}

export enum Precision {
	Day = "DAY",
}

export interface Playability {
	playable: boolean;
	reason: Reason;
}

export enum Reason {
	Playable = "PLAYABLE",
}

export interface SharingInfo {
	shareId: string;
	shareUrl: string;
}

export interface Tracks {
	totalCount: number;
}

export enum PurpleType {
	Album = "ALBUM",
	Ep = "EP",
	Single = "SINGLE",
}

export interface PopularReleasesAlbums {
	items: MerchItem[];
	totalCount: number;
}

export interface TopTracks {
	items: TopTracksItem[];
}

export interface TopTracksItem {
	track: Track;
	uid: string;
}

export interface Track {
	albumOfTrack: TrackAlbumOfTrack;
	artists: Artists;
	associationsV3: TrackAssociationsV3;
	contentRating: ContentRating;
	discNumber: number;
	duration: Duration;
	id: string;
	name: string;
	playability: Playability;
	playcount: string;
	uri: string;
}

export interface TrackAlbumOfTrack {
	coverArt: CoverArt;
	uri: string;
}

export interface CoverArt {
	sources: PurpleSource[];
}

export interface PurpleSource {
	url: string;
}

export interface Artists {
	items: ArtistsItem[];
}

export interface ArtistsItem {
	profile: ItemProfile;
	uri: string;
}

export interface ItemProfile {
	name: string;
}

export interface TrackAssociationsV3 {
	videoAssociations: Tracks;
}

export interface ContentRating {
	label: Label;
}

export enum Label {
	Explicit = "EXPLICIT",
	None = "NONE",
}

export interface Duration {
	totalMilliseconds: number;
}

export interface Goods {
	concerts: Concerts;
	merch: Merch;
}

export interface Concerts {
	items: ConcertsItem[];
	totalCount: number;
}

export interface ConcertsItem {
	data: PurpleData;
}

export interface PurpleData {
	__typename: PurpleTypename;
	festival: boolean;
	location: Location;
	startDateIsoString: string;
	title: string;
	uri: string;
}

export enum PurpleTypename {
	ConcertV2 = "ConcertV2",
}

export interface Location {
	city: string;
	name: string;
}

export interface HeaderImage {
	data: HeaderImageData;
}

export interface HeaderImageData {
	__typename: string;
	sources: DataSource[];
}

export interface DataSource {
	maxHeight: number;
	maxWidth: number;
	url: string;
	imageFormat?: string;
}

export interface ArtistUnionProfile {
	biography: Biography;
	externalLinks: ExternalLinks;
	name: string;
	pinnedItem: null;
	playlistsV2: PlaylistsV2;
	verified: boolean;
}

export interface ExternalLinks {
	items: ExternalLinksItem[];
}

export interface ExternalLinksItem {
	name: string;
	url: string;
}

export interface PlaylistsV2 {
	items: PlaylistsV2Item[];
	totalCount: number;
}

export interface PlaylistsV2Item {
	data: FluffyData;
}

export interface FluffyData {
	__typename: FluffyTypename;
	description: string;
	images: Gallery;
	name: string;
	ownerV2: OwnerV2;
	uri: string;
}

export enum FluffyTypename {
	GenericError = "GenericError",
	Playlist = "Playlist",
}

export interface Gallery {
	items: CoverArtElement[];
}

export interface OwnerV2 {
	data: OwnerV2Data;
}

export interface OwnerV2Data {
	__typename: TentacledTypename;
	name: string;
}

export enum TentacledTypename {
	User = "User",
}

export interface RelatedContent {
	appearsOn: AppearsOn;
	discoveredOnV2: V2;
	featuringV2: V2;
	relatedArtists: RelatedArtists;
}

export interface AppearsOn {
	items: AppearsOnItem[];
	totalCount: number;
}

export interface AppearsOnItem {
	releases: Releases;
}

export interface Releases {
	items: PurpleItem[];
	totalCount: number;
}

export interface PurpleItem {
	artists: Artists;
	coverArt: CoverArtElement;
	date: FluffyDate;
	id: string;
	name: string;
	sharingInfo: SharingInfo;
	type: FluffyType;
	uri: string;
}

export interface FluffyDate {
	year: number;
}

export enum FluffyType {
	Album = "ALBUM",
	Compilation = "COMPILATION",
}

export interface V2 {
	items: DiscoveredOnV2Item[];
	totalCount: number;
}

export interface DiscoveredOnV2Item {
	data: TentacledData;
}

export interface TentacledData {
	__typename: FluffyTypename;
	description?: string;
	id?: string;
	images?: Images;
	name?: string;
	ownerV2?: OwnerV2;
	uri?: string;
}

export interface Images {
	items: CoverArtElement[];
	totalCount: number;
}

export interface RelatedArtists {
	items: RelatedArtistsItem[];
	totalCount: number;
}

export interface RelatedArtistsItem {
	id: string;
	profile: ItemProfile;
	uri: string;
	visuals: ItemVisuals;
}

export interface ItemVisuals {
	avatarImage: CoverArtElement;
}

export interface EdMusicVideos {
	__typename: string;
	items: RelatedMusicVideosItem[];
	pagingInfo: PagingInfo;
	totalCount: number;
}

export interface RelatedMusicVideosItem {
	_uri: string;
	data: StickyData;
}

export interface StickyData {
	__typename: StickyTypename;
	albumOfTrack: DataAlbumOfTrack;
	artists: Artists;
	associationsV3: DataAssociationsV3;
	contentRating: ContentRating;
	name: string;
	uri: string;
}

export enum StickyTypename {
	Track = "Track",
}

export interface DataAlbumOfTrack {
	coverArt: CoverArtElement;
	uri: string;
}

export interface DataAssociationsV3 {
	audioAssociations: AudioAssociations;
}

export interface AudioAssociations {
	items: AudioAssociationsItem[];
}

export interface AudioAssociationsItem {
	trackAudio: TrackAudio;
}

export interface TrackAudio {
	_uri: string;
}

export interface PagingInfo {
	nextOffset: null;
}

export interface Stats {
	followers: number;
	monthlyListeners: number;
	topCities: TopCities;
	worldRank: number;
}

export interface TopCities {
	items: TopCitiesItem[];
}

export interface TopCitiesItem {
	city: string;
	country: string;
	numberOfListeners: number;
	region: string;
}

export interface VisualIdentity {
	wideFullBleedImage: WideFullBleedImage;
}

export interface WideFullBleedImage {
	__typename: string;
	extractedColorSet: ExtractedColorSet;
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

export interface ArtistUnionVisuals {
	avatarImage: AvatarImage | null;
	gallery: Gallery;
}

export interface AvatarImage {
	extractedColors: ExtractedColors;
	sources: ItemSource[];
}

export interface ExtractedColors {
	colorRaw: ColorRaw;
}

export interface ColorRaw {
	hex: string;
}

export interface WatchFeedEntrypoint {
	entrypointUri: string;
	thumbnailImage: ThumbnailImage;
	video: null;
}

export interface ThumbnailImage {
	data: ThumbnailImageData;
}

export interface ThumbnailImageData {
	__typename: string;
	imageId: string;
	imageIdType: string;
	sources: DataSource[];
}
