import type { MatchViewMode } from "./types";

/**
 * Validated search shape for /match.
 *
 * Only `mode=playlist` is retained — song is the canonical default (A3):
 *   /match           → song mode (no param)
 *   /match?mode=playlist → playlist mode
 *   /match?mode=song → non-canonical; callers normalise away via replace:true
 */
export interface MatchSearch {
	mode?: "playlist";
}

/**
 * TanStack Router `validateSearch` implementation for /match.
 *
 * Accepts only `mode=playlist`; drops `mode=song` and invalid values so the
 * returned shape never contains a non-canonical mode. Callers that need to
 * detect and redirect non-canonical inputs should call `hasNonCanonicalMatchMode`
 * on the raw params first.
 */
export function validateMatchSearch(raw: Record<string, unknown>): MatchSearch {
	if (raw.mode === "playlist") {
		return { mode: "playlist" };
	}
	return {};
}

/**
 * Derive the UI view mode from a validated MatchSearch.
 * Returns `'song'` when no mode param is present (canonical default).
 */
export function modeFromSearch(search: MatchSearch): MatchViewMode {
	return search.mode ?? "song";
}

/**
 * True when the raw search params contain a `mode` value that is not the
 * canonical playlist token — i.e. `mode=song` or any unrecognised string.
 * Used by the route to redirect non-canonical URLs with `replace: true`.
 */
export function hasNonCanonicalMatchMode(
	raw: Record<string, unknown>,
): boolean {
	const mode = raw.mode;
	if (mode === undefined) return false;
	return mode !== "playlist";
}
