import { parseStoredMatchFilters } from "@/lib/domains/taste/match-filters/schemas";

/**
 * Exported for unit-testing the warn contract: when wasNormalized is true
 * the caller (toSummary) must emit a structured warning with full context so
 * ops can trace corrupt stored data back to the owning account + playlist.
 */
export function parseSummaryMatchFilters(
	accountId: string,
	playlistId: string,
	raw: unknown,
): ReturnType<typeof parseStoredMatchFilters> {
	const parsed = parseStoredMatchFilters(raw);
	if (parsed.wasNormalized) {
		// Invalid stored match_filters must not crash the screen — normalize to
		// { version: 1 } and log so ops can diagnose without user-facing errors.
		console.warn("[playlists] invalid stored match_filters normalized", {
			accountId,
			playlistId,
			raw,
		});
	}
	return parsed;
}
