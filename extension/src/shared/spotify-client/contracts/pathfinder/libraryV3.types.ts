export interface LibraryV3 {
	data: LibraryV3Data;
}

export interface LibraryV3Data {
	me: Me;
}

export interface Me {
	libraryV3: LibraryV3Class;
}

export interface LibraryV3Class {
	__typename: string;
	availableFilters: SelectedSortOrder[];
	availableSortOrders: SelectedSortOrder[];
	breadcrumbs: any[];
	items: ItemElement[];
	pagingInfo: PagingInfo;
	selectedFilters: SelectedSortOrder[];
	selectedSortOrder: SelectedSortOrder;
	totalCount: number;
}

export interface SelectedSortOrder {
	id: string;
	name: string;
}

export interface ItemElement {
	addedAt: AddedAt;
	depth: number;
	item: ItemItem;
	pinnable: boolean;
	pinned: boolean;
	playedAt: string | null;
}

export interface AddedAt {
	isoString: string;
}

export interface ItemItem {
	__typename: string;
	_uri: string;
	data: ItemData;
}

export interface ItemData {
	__typename: string;
	count?: number;
	image?: Image;
	name?: string;
	uri?: string;
	attributes?: any[];
	currentUserCapabilities?: CurrentUserCapabilities;
	description?: string;
	format?: string;
	images?: Images;
	ownerV2?: OwnerV2;
	revisionId?: string;
}

export interface CurrentUserCapabilities {
	canEditItems: boolean;
	canView: boolean;
}

export interface Image {
	extractedColors: ExtractedColors;
	sources: Source[];
}

export interface ExtractedColors {
	colorDark: ColorDark;
}

export interface ColorDark {
	hex: string;
	isFallback: boolean;
}

export interface Source {
	height: number | null;
	url: string;
	width: number | null;
}

export interface Images {
	items: Image[];
}

export interface OwnerV2 {
	data: OwnerV2Data;
}

export interface OwnerV2Data {
	__typename: string;
	avatar: Avatar | null;
	id: string;
	name: string;
	uri: string;
	username: string;
}

export interface Avatar {
	sources: Source[];
}

export interface PagingInfo {
	limit: number;
	offset: number;
}
