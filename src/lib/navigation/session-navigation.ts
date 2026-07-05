/**
 * Tracks whether the user has performed any in-app navigation during this page
 * load. Starts `false` so the initial SSR render and the client's first
 * hydration render agree (no hydration mismatch), then flips to `true` the first
 * time the client history changes.
 *
 * Lets a page distinguish "user landed here directly" (first paint of the page
 * load) from "user navigated here in-app", so entrance animations can play only
 * on a genuine first landing.
 */

let navigated = false;

/** True once any client-side navigation has occurred this page load. */
export function hasNavigatedThisSession(): boolean {
	return navigated;
}

/** Marks that an in-app navigation has occurred. Called from router boot. */
export function markNavigated(): void {
	navigated = true;
}
