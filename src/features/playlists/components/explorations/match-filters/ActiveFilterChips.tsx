import {
	languageLabel,
	likedAtLabel,
	releaseYearLabel,
	vocalGenderLabel,
} from "@/lib/domains/taste/match-filters/labels";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import { FilterChip } from "./FilterChip";

interface ActiveFilterChipsProps {
	filters: PlaylistMatchFiltersV1;
	/**
	 * When provided, chips render with a remove action. In display-only mode
	 * (outside edit) pass undefined — chips are visible source-of-truth but
	 * not interactive per the decisions doc §7 "Collapsed/non-editing state".
	 */
	onRemoveLanguage?: (code: string) => void;
	onRemoveReleaseYear?: () => void;
	onRemoveLikedAt?: () => void;
	onRemoveVocalGender?: () => void;
}

/**
 * Renders active filter chips in the fixed type order: languages → releaseYear
 * → likedAt → vocalGender. Language chips are one per selected code, preserving
 * selected order. Labels come from the canonical label helpers — never hardcoded.
 */
export function ActiveFilterChips({
	filters,
	onRemoveLanguage,
	onRemoveReleaseYear,
	onRemoveLikedAt,
	onRemoveVocalGender,
}: ActiveFilterChipsProps) {
	const hasAny =
		(filters.languages?.codes.length ?? 0) > 0 ||
		filters.releaseYear !== undefined ||
		filters.likedAt !== undefined ||
		filters.vocalGender !== undefined;

	if (!hasAny) return null;

	return (
		<ul
			className="m-0 list-none flex flex-wrap gap-1.5 p-0"
			aria-label="Active filters"
		>
			{filters.languages?.codes.map((code) => (
				<li key={code}>
					<FilterChip
						label={languageLabel(code)}
						onRemove={
							onRemoveLanguage ? () => onRemoveLanguage(code) : undefined
						}
						removeAriaLabel={`Remove ${languageLabel(code)} language filter`}
					/>
				</li>
			))}

			{filters.releaseYear && (
				<li>
					<FilterChip
						label={releaseYearLabel(filters.releaseYear)}
						onRemove={onRemoveReleaseYear}
						removeAriaLabel="Remove release year filter"
					/>
				</li>
			)}

			{filters.likedAt && (
				<li>
					<FilterChip
						label={likedAtLabel(filters.likedAt)}
						onRemove={onRemoveLikedAt}
						removeAriaLabel="Remove liked date filter"
					/>
				</li>
			)}

			{filters.vocalGender && (
				<li>
					<FilterChip
						label={vocalGenderLabel(filters.vocalGender)}
						onRemove={onRemoveVocalGender}
						removeAriaLabel="Remove vocals filter"
					/>
				</li>
			)}
		</ul>
	);
}
