import type { MatchViewMode } from "./types";

/**
 * Validated search shape for /match.
 *
 * Only `mode=song` is retained — playlist is the canonical default (A3):
 *   /match           → playlist mode (no param)
 *   /match?mode=song → song mode
 *   /match?mode=playlist → non-canonical; callers normalise away via replace:true
 */
export interface MatchSearch {
	mode?: "song";
}

/**
 * TanStack Router `validateSearch` implementation for /match.
 *
 * Accepts only `mode=song`; drops `mode=playlist` and invalid values so the
 * returned shape never contains a non-canonical mode. Callers that need to
 * detect and redirect non-canonical inputs should call `hasNonCanonicalMatchMode`
 * on the raw params first.
 */
export function validateMatchSearch(raw: Record<string, unknown>): MatchSearch {
	if (raw.mode === "song") {
		return { mode: "song" };
	}
	return {};
}

/**
 * Derive the UI view mode from a validated MatchSearch.
 * Returns `'playlist'` when no mode param is present (canonical default).
 */
export function modeFromSearch(search: MatchSearch): MatchViewMode {
	return search.mode ?? "playlist";
}

/**
 * True when the raw search params contain a `mode` value that is not the
 * canonical song token — i.e. `mode=playlist` or any unrecognised string.
 * Used by the route to redirect non-canonical URLs with `replace: true`.
 */
export function hasNonCanonicalMatchMode(
	raw: Record<string, unknown>,
): boolean {
	const mode = raw.mode;
	if (mode === undefined) return false;
	return mode !== "song";
}
