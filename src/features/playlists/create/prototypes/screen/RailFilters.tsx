/**
 * The studio rail's filters slot — settled. The editor placement decision is
 * closed: prod's restyled MatchFiltersFieldList sits inline in the 300px rail
 * (popover was too hidden; a rail-tuned rebuild was tried and dropped once prod
 * itself was restyled to the quiet rail register). This is now just the state
 * harness the prototype needs — prod's editor owns a single draft via the
 * caller — so the promotion wires the real query-backed draft in this spot.
 */

import { useState } from "react";
import { MatchFiltersFieldList } from "@/features/playlists/components/match-filters/MatchFiltersFieldList";
import { MOCK_FILTER_OPTIONS } from "@/features/playlists/components/match-filters/mock-filter-options";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";

// A couple of facets active up front so the editor isn't judged empty.
const INITIAL_FILTERS: PlaylistMatchFiltersV1 = {
	version: 1,
	languages: { codes: ["en", "pt"] },
	releaseYear: { kind: "range", start: 2010, end: 2019 },
};

export function RailFilters() {
	const [filters, setFilters] =
		useState<PlaylistMatchFiltersV1>(INITIAL_FILTERS);

	return (
		<MatchFiltersFieldList
			filters={filters}
			onFiltersChange={setFilters}
			options={MOCK_FILTER_OPTIONS}
			optionsState="ready"
		/>
	);
}
