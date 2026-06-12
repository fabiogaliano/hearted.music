/**
 * Canonical genre options + ranked search for the genre-pills picker.
 *
 * The whitelist (`GENRE_LIST`) ships ~430 raw entries that include variant
 * spellings of the same genre ("hip hop" & "hip-hop", "r&b" & "rnb"). The
 * picker renders ONE chip per canonical form (rendered as-is — `rnb`, not
 * `R&B`), but every variant spelling stays a search alias so typing "r&b"
 * still surfaces the `rnb` chip. Everything here is pure data over the
 * client-safe whitelist exports — no server-only deps.
 */

import { genreNeighbors } from "@/lib/domains/taste/genre-similarity/loader";
import {
	canonicalizeGenre,
	GENRE_LIST,
} from "@/lib/integrations/lastfm/whitelist";

export interface GenreOption {
	/** Canonical storage form, also the display label (rendered verbatim). */
	value: string;
	/** Lowercased search terms: the canonical form plus every variant spelling. */
	aliases: readonly string[];
}

// Fold the whitelist down to canonical options once at module load, collecting
// every raw spelling that canonicalizes to each form as a search alias. A Map
// keyed by canonical form dedupes the variants while preserving first-seen order.
const aliasesByCanonical = new Map<string, Set<string>>();
for (const raw of GENRE_LIST) {
	const canonical = canonicalizeGenre(raw);
	let aliases = aliasesByCanonical.get(canonical);
	if (!aliases) {
		aliases = new Set<string>([canonical]);
		aliasesByCanonical.set(canonical, aliases);
	}
	aliases.add(raw.toLowerCase());
}

export const GENRE_OPTIONS: readonly GenreOption[] = Array.from(
	aliasesByCanonical,
	([value, aliases]) => ({ value, aliases: Array.from(aliases) }),
);

const GENRE_OPTION_VALUES: ReadonlySet<string> = new Set(
	GENRE_OPTIONS.map((option) => option.value),
);

/** True when `genre` (canonicalized) is a real selectable option. */
export function isGenreOption(genre: string): boolean {
	return GENRE_OPTION_VALUES.has(canonicalizeGenre(genre.toLowerCase()));
}

const GENRE_OPTIONS_ALPHABETICAL: readonly GenreOption[] = [
	...GENRE_OPTIONS,
].sort((a, b) => a.value.localeCompare(b.value));

// Match tiers, best-first. An option's rank is the strongest tier any of its
// aliases hits; ranking by alias means "r&b" prefix-matches even though the
// rendered value is "rnb". A word boundary is any run of separators the
// whitelist uses between words ("drum and bass", "post-rock", "lo-fi hip-hop").
const RANK_EXACT = 0;
const RANK_PREFIX = 1;
const RANK_WORD = 2;
const RANK_SUBSTRING = 3;
const RANK_NONE = 4;

const WORD_SEPARATOR = /[\s\-&/]+/;

function aliasRank(alias: string, query: string): number {
	if (alias === query) return RANK_EXACT;
	if (alias.startsWith(query)) return RANK_PREFIX;
	const words = alias.split(WORD_SEPARATOR);
	if (words.some((word) => word.startsWith(query))) return RANK_WORD;
	if (alias.includes(query)) return RANK_SUBSTRING;
	return RANK_NONE;
}

function optionRank(option: GenreOption, query: string): number {
	let best = RANK_NONE;
	for (const alias of option.aliases) {
		const rank = aliasRank(alias, query);
		if (rank < best) best = rank;
		if (best === RANK_EXACT) break;
	}
	return best;
}

export interface SearchGenresOptions {
	/** Canonical values to omit (already-selected pills). */
	exclude?: ReadonlySet<string>;
	/** Cap on returned options (the dropdown shows a bounded list). */
	limit?: number;
}

/**
 * Rank genre options against a query: exact > prefix > word-boundary >
 * substring, ties broken alphabetically. An empty query returns all options
 * alphabetically (so ↓ on an empty input can still open a full list). Excluded
 * values are dropped before ranking.
 */
export function searchGenres(
	query: string,
	{ exclude, limit }: SearchGenresOptions = {},
): GenreOption[] {
	const normalized = query.trim().toLowerCase();
	const isExcluded = (option: GenreOption) =>
		exclude?.has(option.value) ?? false;

	if (normalized === "") {
		const all = GENRE_OPTIONS_ALPHABETICAL.filter(
			(option) => !isExcluded(option),
		);
		return limit === undefined ? all : all.slice(0, limit);
	}

	const ranked: Array<{ option: GenreOption; rank: number }> = [];
	for (const option of GENRE_OPTIONS) {
		if (isExcluded(option)) continue;
		const rank = optionRank(option, normalized);
		if (rank !== RANK_NONE) ranked.push({ option, rank });
	}

	ranked.sort(
		(a, b) => a.rank - b.rank || a.option.value.localeCompare(b.option.value),
	);

	const result = ranked.map((entry) => entry.option);
	return limit === undefined ? result : result.slice(0, limit);
}

export interface SuggestQuickPicksOptions {
	/** The account's top library genres (canonical), the discovery seed. */
	topGenres?: readonly string[];
	/** Currently-selected pills — excluded, and (once non-empty) the steer. */
	selected: readonly string[];
	limit?: number;
}

/**
 * Suggestion pills for the picker. With nothing picked yet, surfaces the
 * account's top library genres (every one guaranteed actionable). Once the user
 * picks a genre, leads with genres adjacent to the picks — ranked by curated
 * similarity from `genreNeighbors` — so suggestions react to the declaration in
 * progress, then backfills with top library genres. Already-selected pills and
 * non-whitelist neighbors are filtered out.
 */
export function suggestQuickPicks({
	topGenres = [],
	selected,
	limit = 8,
}: SuggestQuickPicksOptions): string[] {
	const seen = new Set(selected.map((g) => canonicalizeGenre(g.toLowerCase())));
	const result: string[] = [];

	const push = (genre: string) => {
		const canonical = canonicalizeGenre(genre.toLowerCase());
		if (seen.has(canonical)) return;
		if (!GENRE_OPTION_VALUES.has(canonical)) return;
		seen.add(canonical);
		result.push(canonical);
	};

	if (selected.length > 0) {
		// Collapse every pick's neighbors into one ranked list, keeping each
		// neighbor's strongest similarity to any pick.
		const neighborScores = new Map<string, number>();
		for (const pill of selected) {
			for (const [neighbor, sim] of Object.entries(genreNeighbors(pill))) {
				const canonical = canonicalizeGenre(neighbor.toLowerCase());
				neighborScores.set(
					canonical,
					Math.max(neighborScores.get(canonical) ?? 0, sim),
				);
			}
		}
		const adjacent = [...neighborScores.entries()]
			.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
			.map(([genre]) => genre);
		for (const genre of adjacent) {
			if (result.length >= limit) break;
			push(genre);
		}
	}

	for (const genre of topGenres) {
		if (result.length >= limit) break;
		push(genre);
	}

	return result;
}
