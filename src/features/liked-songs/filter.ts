import type { FilterOption } from "./queries";

export const SEARCH_FILTER_VALUES = [
	"all",
	"pending",
	"analyzed",
	"locked",
] as const;

export type SearchFilter = (typeof SEARCH_FILTER_VALUES)[number];

export function isSearchFilter(value: string): value is SearchFilter {
	return SEARCH_FILTER_VALUES.some((option) => option === value);
}

export function toQueryFilter(filter: SearchFilter): FilterOption {
	// `locked` is a client-only filter projection over `displayState`. The
	// server has no `locked` enum value, so fetch the full set and let
	// useLikedSongsListModel filter visible rows + auto-paginate until matches
	// surface (same pattern as selection mode).
	if (filter === "locked") return "all";
	return filter;
}
