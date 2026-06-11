/**
 * Two separate questions live here, and they have different reliability:
 *
 * 1. WHICH STORE can install our build — engine family only. Firefox is the one
 *    target that omits `Chrome/` from its UA, so "is it Firefox?" cleanly splits
 *    our two builds. Every Chromium brand (Chrome, Edge, Brave, Arc, Dia,
 *    Helium, …) installs from the Chrome Web Store. This is reliable and
 *    SSR-safe, so it drives the actual href.
 *
 * 2. WHAT TO CALL the browser — a cosmetic label ("add to Arc"). Best-effort
 *    only. Some brands announce themselves (Edge/Opera/Vivaldi/Samsung via a UA
 *    token), Brave via the async `navigator.brave` hook, Arc via CSS variables
 *    it injects post-load. Privacy forks like Dia and Helium expose nothing and
 *    honestly read as "Chrome". The label never changes which store we link to.
 */

export type BrowserTarget = "firefox" | "chromium";

const CHROME_STORE_URL =
	"https://chromewebstore.google.com/detail/everything-you-ever-heart/ohaaafmgbbfohhjhogonolonpjhhfohk";
// Live AMO listing slug (reserved; public once approved).
const FIREFOX_STORE_URL =
	"https://addons.mozilla.org/firefox/addon/everything-you-ever-hearted/";

export function getBrowserTarget(): BrowserTarget {
	if (typeof navigator === "undefined") return "chromium";
	return /firefox\//i.test(navigator.userAgent) ? "firefox" : "chromium";
}

export function getExtensionStoreUrl(target: BrowserTarget): string {
	return target === "firefox" ? FIREFOX_STORE_URL : CHROME_STORE_URL;
}

/**
 * Synchronous name from the UA string alone — safe at first paint. Covers the
 * brands that keep an identifying token; everything else (including Brave, Arc,
 * Dia, Helium) reads as "Chrome" here and may get upgraded by refineBrowserName.
 */
export function getBrowserName(): string {
	if (typeof navigator === "undefined") return "Chrome";
	const ua = navigator.userAgent;
	if (/firefox\//i.test(ua)) return "Firefox";
	if (/edg\//i.test(ua)) return "Edge";
	if (/opr\//i.test(ua) || /\bopera\b/i.test(ua)) return "Opera";
	if (/samsungbrowser\//i.test(ua)) return "Samsung Internet";
	if (/vivaldi/i.test(ua)) return "Vivaldi";
	return "Chrome";
}

type BraveNavigator = Navigator & {
	brave?: { isBrave?: () => Promise<boolean> };
};

async function isBrave(): Promise<boolean> {
	try {
		const nav = navigator as BraveNavigator;
		return (await nav.brave?.isBrave?.()) === true;
	} catch {
		return false;
	}
}

function isArc(): boolean {
	if (typeof document === "undefined") return false;
	// Arc injects --arc-palette-* onto :root, but only after the page loads, so
	// this returns false on first paint and only becomes true on a later re-check.
	const palette = getComputedStyle(document.documentElement).getPropertyValue(
		"--arc-palette-title",
	);
	return palette.trim() !== "";
}

/**
 * Async upgrade of a UA-derived name using signals that aren't in the UA string.
 * Only refines the generic "Chrome" case — a specific UA token (Edge, Opera, …)
 * is already authoritative and shouldn't be second-guessed.
 */
export async function refineBrowserName(base: string): Promise<string> {
	if (base !== "Chrome") return base;
	if (await isBrave()) return "Brave";
	if (isArc()) return "Arc";
	return base;
}
