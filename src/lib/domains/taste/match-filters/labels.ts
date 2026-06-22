/**
 * Display label helper for match-filter language codes.
 *
 * Labels are compact, value-only strings derived from normalized values at
 * render time, never stored. (The release-year / liked-date / vocals formatters
 * that used to live here moved to the field-list UI's facet-helpers, which
 * produce the plain-language strings the redesigned surface shows.)
 */

import { lookupLanguage } from "./languages";

/**
 * Language label for a single code.
 * Falls back to the raw code when lookup fails (shouldn't happen for stored codes).
 */
export function languageLabel(code: string): string {
	return lookupLanguage(code)?.label ?? code;
}
