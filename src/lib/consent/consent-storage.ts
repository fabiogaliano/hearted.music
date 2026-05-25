// Stores the user's analytics/replay consent decision. The preference itself
// is "strictly necessary" under ePrivacy, so persisting it needs no consent —
// it's the thing that records consent. We keep it in a first-party cookie (not
// localStorage) so a future SSR read can decide server-side without a flash.

export type ConsentStatus = "granted" | "denied";

export const CONSENT_COOKIE = "hearted_consent";

// One year is the ICO/CNIL-aligned ceiling for re-asking consent. After it
// lapses the cookie disappears and the banner returns. Anonymous users are
// governed by this cookie window only; there is no DB-backed version check for
// them.
export const CONSENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

function isConsentStatus(value: string): value is ConsentStatus {
	return value === "granted" || value === "denied";
}

export function readConsent(): ConsentStatus | null {
	if (typeof document === "undefined") return null;

	for (const part of document.cookie.split(";")) {
		const [rawName, ...rawValue] = part.split("=");
		if (rawName?.trim() !== CONSENT_COOKIE) continue;

		try {
			const value = decodeURIComponent(rawValue.join("=").trim());
			return isConsentStatus(value) ? value : null;
		} catch {
			return null;
		}
	}
	return null;
}

export function writeConsent(status: ConsentStatus): void {
	if (typeof document === "undefined") return;

	// Secure is safe here because the banner only ever renders in production
	// (https). SameSite=Lax is enough — this cookie is never read cross-site.
	// The Cookie Store API is async and unsupported in Safari; readConsent()
	// must read this synchronously during render, so document.cookie is the
	// correct cross-browser choice.
	// biome-ignore lint/suspicious/noDocumentCookie: synchronous cross-browser write required (see note above)
	document.cookie = [
		`${CONSENT_COOKIE}=${status}`,
		"path=/",
		`max-age=${CONSENT_MAX_AGE_SECONDS}`,
		"samesite=lax",
		"secure",
	].join("; ");
}

// Drops the cached decision. Used when an authenticated user's durable consent
// has lapsed (or its policy version changed) so a stale cookie can't keep
// applying a decision the authenticated source of truth no longer honors.
export function clearConsent(): void {
	if (typeof document === "undefined") return;

	// biome-ignore lint/suspicious/noDocumentCookie: synchronous cross-browser write required (see note above)
	document.cookie = [
		`${CONSENT_COOKIE}=`,
		"path=/",
		"max-age=0",
		"samesite=lax",
		"secure",
	].join("; ");
}
