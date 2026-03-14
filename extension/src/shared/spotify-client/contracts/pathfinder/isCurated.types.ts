export interface IsCurated {
	data: IsCuratedData;
}

export interface IsCuratedData {
	lookup: LookupItem[];
}

export interface LookupItem {
	__typename: string;
	data: LookupItemData;
}

export interface LookupItemData {
	__typename: string;
	isCurated: boolean;
}
