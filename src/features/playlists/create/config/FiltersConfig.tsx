/**
 * FiltersConfig — thin controlled wrapper around MatchFiltersFieldList.
 *
 * MatchFiltersFieldList already accepts value (filters) + onChange (onFiltersChange),
 * so it plugs in directly with no refactor needed. We feed it the account-scoped
 * filter options query and map loading/error into the optionsState prop.
 */

import { useQuery } from "@tanstack/react-query";
import { MatchFiltersFieldList } from "@/features/playlists/components/match-filters/MatchFiltersFieldList";
import { playlistMatchFilterOptionsQueryOptions } from "@/features/playlists/queries";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";

interface FiltersConfigProps {
	accountId: string;
	value: PlaylistMatchFiltersV1;
	onChange: (next: PlaylistMatchFiltersV1) => void;
}

export function FiltersConfig({
	accountId,
	value,
	onChange,
}: FiltersConfigProps) {
	const { data, isLoading, isError } = useQuery(
		playlistMatchFilterOptionsQueryOptions(accountId),
	);

	const optionsState = isError ? "error" : isLoading ? "loading" : "ready";

	// MOCK_FILTER_OPTIONS as a fallback so the editor is never empty-blank while
	// loading — the date/year bounds come from account data anyway and don't affect
	// the filter validity, only the helper presets.
	const options = data ?? {
		languages: [],
		releaseYears: { min: null, max: null },
		likedAt: {
			oldest: null,
			today: new Date().toISOString().slice(0, 10),
			yearCounts: [],
		},
	};

	return (
		<MatchFiltersFieldList
			filters={value}
			onFiltersChange={onChange}
			options={options}
			optionsState={optionsState}
		/>
	);
}
