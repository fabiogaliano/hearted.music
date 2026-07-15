export type PageSize = 25 | 50 | 100;
export type SortDirection = "asc" | "desc";

export interface PageResult<T> {
	rows: T[];
	total: number;
	page: number;
	pageSize: PageSize;
}

export interface ListQuery<TSort extends string> {
	q: string;
	page: number;
	pageSize: PageSize;
	sort: TSort;
	direction: SortDirection;
}

function parsePositiveInteger(value: string | null): number | null {
	if (value === null || !/^\d+$/.test(value)) return null;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) ? parsed : null;
}

function parsePageSize(value: string | null): PageSize {
	if (value === "25") return 25;
	if (value === "100") return 100;
	return 50;
}

export function parseListQuery<TSort extends string>(
	url: URL,
	sortColumns: readonly TSort[],
	defaultSort: TSort,
	defaultDirection: SortDirection = "desc",
): ListQuery<TSort> {
	const requestedSort = url.searchParams.get("sort");
	const sort = sortColumns.find((column) => column === requestedSort) ?? defaultSort;
	const page = parsePositiveInteger(url.searchParams.get("page")) ?? 1;
	const direction = url.searchParams.get("direction");

	return {
		q: url.searchParams.get("q")?.trim() ?? "",
		page: Math.max(1, page),
		pageSize: parsePageSize(url.searchParams.get("pageSize")),
		sort,
		direction: direction === "asc" || direction === "desc" ? direction : defaultDirection,
	};
}

// Review queues order by a single natural time column rather than an
// operator-chosen sort key, so they share a leaner query than parseListQuery:
// just search, an oldest/newest toggle, and paging.
export type QueueOrder = "oldest" | "newest";

export interface QueueQuery {
	q: string;
	order: QueueOrder;
	page: number;
	pageSize: PageSize;
}

export function parseQueueQuery(url: URL, defaultOrder: QueueOrder = "oldest"): QueueQuery {
	const page = parsePositiveInteger(url.searchParams.get("page")) ?? 1;
	const order = url.searchParams.get("order");
	return {
		q: url.searchParams.get("q")?.trim() ?? "",
		order: order === "oldest" || order === "newest" ? order : defaultOrder,
		page: Math.max(1, page),
		pageSize: parsePageSize(url.searchParams.get("pageSize")),
	};
}
