/**
 * Strict calendar-date validation for match-filter date strings.
 *
 * A regex match alone accepts impossible dates like `2024-02-31`; the JS Date
 * constructor then silently rolls them over (→ `2024-03-02`) or yields NaN,
 * which corrupts filter boundaries or produces an all-fail predicate. Parsing
 * the string and comparing the canonical ISO form back to the input rejects any
 * value that isn't a real calendar day, including invalid leap days.
 */

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** True only for a well-formed `YYYY-MM-DD` string naming a real calendar date. */
export function isValidDateOnly(value: string): boolean {
	if (!DATE_ONLY_PATTERN.test(value)) return false;
	const parsed = new Date(`${value}T00:00:00Z`);
	if (Number.isNaN(parsed.getTime())) return false;
	// Round-trip: if the date rolled over (Feb 31 → Mar 2), the canonical form
	// won't match the input, so the original was not a real day.
	return parsed.toISOString().slice(0, 10) === value;
}

/** The UTC calendar date (`YYYY-MM-DD`) for a given epoch-ms instant. */
export function utcDateString(ms: number): string {
	return new Date(ms).toISOString().slice(0, 10);
}
