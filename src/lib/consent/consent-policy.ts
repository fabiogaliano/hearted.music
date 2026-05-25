// The single app-level rule for whether a stored consent decision still counts.
// Kept free of any cookie/SDK/server imports so both the server resolver
// (preferences-queries) and the client provider can share it.

import type { ConsentStatus } from "./consent-storage";

// Bump when consent copy or the data-use policy materially changes: durable
// DB-backed decisions made under an older version resolve to "stale" and
// re-prompt. Anonymous cookie-only users are not versioned; they are re-asked
// only when their cookie expires.
export const CURRENT_CONSENT_VERSION = 1;

// 12 months — the ICO/CNIL-aligned ceiling for re-asking, matching the cookie's
// max-age in consent-storage.ts so authenticated DB consent and the cookie
// cache expire on the same schedule.
const CONSENT_VALIDITY_MS = 1000 * 60 * 60 * 24 * 365;

export type ResolvedConsent =
	// A current, in-window durable decision we can trust without asking again.
	| { state: "valid"; status: ConsentStatus }
	// A durable DB decision exists but has expired or predates the current
	// policy version — must re-ask, and any cached cookie should be discarded as
	// misleading.
	| { state: "stale" }
	// No decision on record. A still-valid cookie may be backfilled here once.
	| { state: "absent" };

export interface StoredConsentFields {
	consent_status: string | null;
	consent_updated_at: string | null;
	consent_version: number | null;
}

export function evaluateStoredConsent(
	fields: StoredConsentFields,
	now: number = Date.now(),
): ResolvedConsent {
	const { consent_status, consent_updated_at, consent_version } = fields;

	// The DB triplet constraint guarantees all-or-nothing, but a missing piece
	// here means there is simply nothing to honor.
	if (
		consent_status === null ||
		consent_updated_at === null ||
		consent_version === null
	) {
		return { state: "absent" };
	}

	if (consent_status !== "granted" && consent_status !== "denied") {
		return { state: "stale" };
	}

	if (consent_version !== CURRENT_CONSENT_VERSION) {
		return { state: "stale" };
	}

	const updatedAt = Date.parse(consent_updated_at);
	if (Number.isNaN(updatedAt) || now - updatedAt > CONSENT_VALIDITY_MS) {
		return { state: "stale" };
	}

	return { state: "valid", status: consent_status };
}
