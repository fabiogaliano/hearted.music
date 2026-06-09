// transliteration is a server-only dependency: it pulls in Node.js-specific
// data files that should not be bundled for the browser.
import { transliterate } from "transliteration";

export function derivePassiveHandlePrefill(displayName: string): string {
	const ascii = transliterate(displayName, { unknown: "" });
	const lowered = ascii.toLowerCase();
	// Collapse every run of non-alphanumeric characters to a single underscore so
	// accented-char residue, punctuation, and spaces all become clean separators.
	const collapsed = lowered.replace(/[^a-z0-9]+/g, "_");
	const trimmed = collapsed.replace(/^_+|_+$/g, "");
	const truncated = trimmed.slice(0, 30);
	return truncated;
}
