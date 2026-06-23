/**
 * Curated set of genre keywords that reliably indicate an instrumental track.
 *
 * Inclusion criteria: genres where nearly all releases are instrumental and
 * a false-positive (calling a vocal track instrumental) is rare.
 *
 * Excluded: generic electronic tags (house, techno, deep house, electronic,
 * dance) because they contain substantial vocal repertoires (e.g. Daft Punk
 * "Veridis Quo" is electronic but most of that genre is vocal). Those tags are
 * left to the instrumentalness ≥ 0.9 tiebreak at step 4 of the classifier.
 *
 * Added: post-bop, chamber music, orchestral, film score, soundtrack — common
 * in classical-adjacent catalogs that surface as instrumentals. Trap instrumental
 * and lo-fi are added because genre-tagged tracks with those strings are almost
 * exclusively instrumental beat releases. Jazz is excluded (too many vocal jazz
 * recordings). See design.md Decision 3 for rationale.
 */

const RAW_INSTRUMENTAL_GENRES: readonly string[] = [
	"instrumental",
	"instrumental hip-hop",
	"instrumental hip hop",
	"neoclassical",
	"neoclassical darkwave",
	"contemporary classical",
	"classical",
	"chamber music",
	"orchestral",
	"film score",
	"soundtrack",
	"ambient",
	"drone",
	"post-rock",
	"post rock",
	"math rock",
	"trap instrumental",
	"lo-fi instrumental",
	"lo fi instrumental",
	"beats",
	"chillhop",
];

/**
 * Normalises a genre string for comparison: lower-case, collapse whitespace,
 * strip leading/trailing spaces.
 */
function normaliseGenre(genre: string): string {
	return genre.toLowerCase().replace(/\s+/g, " ").trim();
}

const INSTRUMENTAL_GENRE_SET: ReadonlySet<string> = new Set(
	RAW_INSTRUMENTAL_GENRES.map(normaliseGenre),
);

/**
 * Returns true when any of the supplied genre strings matches the curated
 * instrumental keyword set (case- and whitespace-insensitive).
 */
export function hasInstrumentalGenre(genres: string[]): boolean {
	return genres.some((g) => INSTRUMENTAL_GENRE_SET.has(normaliseGenre(g)));
}

/**
 * Returns the first supplied genre that matches the curated instrumental set, or
 * null when none do. Used to record WHICH genre drove an instrumental
 * determination for operator review.
 */
export function matchedInstrumentalGenre(genres: string[]): string | null {
	return (
		genres.find((g) => INSTRUMENTAL_GENRE_SET.has(normaliseGenre(g))) ?? null
	);
}
