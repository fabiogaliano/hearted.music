/**
 * Artist and album name normalization for Last.fm API lookups.
 *
 * Last.fm works better with clean, canonical names:
 * - Primary artist only (not "Artist & Guest")
 * - Album without version suffixes (not "Album - Remastered 2024")
 */

/** Separators that indicate multiple artists */
const ARTIST_SEPARATORS = [", ", " & ", " and ", " x ", " X ", " vs ", " vs. "];

/** Patterns for featuring/collaboration in names */
const COLLABORATOR_PATTERNS = [
	/\s*\(with\s+[^)]+\)\s*/gi,
	/\s*\(feat\.?\s+[^)]+\)\s*/gi,
	/\s*\(featuring\s+[^)]+\)\s*/gi,
	/\s*\(ft\.?\s+[^)]+\)\s*/gi,
];

/** Patterns for version suffixes in album names */
const VERSION_SUFFIX_PATTERNS = [
	/\s*-\s*remaster(ed)?\s*(\d{4})?\s*/gi,
	/\s*-\s*\d{4}\s*remaster(ed)?\s*/gi,
	/\s*-\s*radio\s*edit\s*/gi,
	/\s*-\s*single\s*version\s*/gi,
	/\s*-\s*album\s*version\s*/gi,
	/\s*-\s*live\s*/gi,
	/\s*-\s*acoustic\s*/gi,
	/\s*\(remaster(ed)?\s*(\d{4})?\)\s*/gi,
	/\s*\(deluxe(\s+edition)?\)\s*/gi,
	/\s*\(expanded(\s+edition)?\)\s*/gi,
	/\s*\(\d{4}(\s+edition)?\)\s*/gi,
	/\s*\(\d{4}\s+remaster(ed)?\)\s*/gi,
	/\s*\(anniversary(\s+edition)?\)\s*/gi,
	/\s*\(bonus\s+track(\s+version)?\)\s*/gi,
	/\s*\(special(\s+edition)?\)\s*/gi,
];

/**
 * Extract the primary artist from a collaborative artist string.
 *
 * @example
 * extractPrimaryArtist("Drake & Future") // "Drake"
 * extractPrimaryArtist("Tyler, the Creator, Pharrell") // "Tyler, the Creator"
 */
export function extractPrimaryArtist(artist: string): string {
	for (const sep of ARTIST_SEPARATORS) {
		if (artist.includes(sep)) {
			return artist.split(sep)[0].trim();
		}
	}
	return artist;
}

/**
 * Normalize an album name by removing version suffixes and collaborator credits.
 *
 * @example
 * normalizeAlbumName("Abbey Road - 2019 Remaster") // "Abbey Road"
 * normalizeAlbumName("Thriller (Deluxe Edition)") // "Thriller"
 * normalizeAlbumName("Song (feat. Artist)") // "Song"
 */
export function normalizeAlbumName(album: string): string {
	let normalized = album;

	// Remove collaborator patterns
	for (const pattern of COLLABORATOR_PATTERNS) {
		normalized = normalized.replace(pattern, "");
	}

	// Remove version suffixes
	for (const pattern of VERSION_SUFFIX_PATTERNS) {
		normalized = normalized.replace(pattern, "");
	}

	// Clean up whitespace
	return normalized.replace(/\s+/g, " ").trim();
}
