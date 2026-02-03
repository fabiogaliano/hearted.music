/**
 * Slug generation utilities for URL-safe identifiers
 */

/**
 * Generate a URL-safe slug from artist and song name
 * Used for deep linking to specific songs
 */
export function generateSongSlug(artist: string, name: string): string {
	const combined = `${artist}-${name}`;
	return combined
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 100);
}
