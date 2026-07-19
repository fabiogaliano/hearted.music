/**
 * Recovery for lazy-route imports that 404 after a deploy.
 *
 * A deploy replaces the content-hashed asset files, so a tab opened before it
 * asks for a bundle that no longer exists the next time it navigates to a lazy
 * route. Nothing in the running page can fix that — the code it needs is gone —
 * so the only recovery is a reload onto the current build.
 */

const RELOAD_MARKER_KEY = "hearted:stale-chunk-reloaded";

// Wording differs per browser: Firefox says "error loading dynamically imported
// module", Chrome "Failed to fetch dynamically imported module", Safari
// "Importing a module script failed".
const STALE_CHUNK_MARKERS = [
	"error loading dynamically imported module",
	"failed to fetch dynamically imported module",
	"importing a module script failed",
	"unable to preload css",
];

function errorText(error: unknown): string {
	if (typeof error === "string") return error;
	if (error instanceof Error) return `${error.name}: ${error.message}`;
	return "";
}

export function isStaleChunkError(error: unknown): boolean {
	const text = errorText(error).toLowerCase();
	if (text === "") return false;
	return STALE_CHUNK_MARKERS.some((marker) => text.includes(marker));
}

/**
 * Reloads once onto the current build when `error` is a stale-chunk failure.
 * Returns whether a reload was triggered, so the caller can skip reporting a
 * failure the user is about to recover from automatically.
 */
export function recoverFromStaleChunk(error: unknown): boolean {
	if (typeof window === "undefined") return false;
	if (!isStaleChunkError(error)) return false;

	// One reload only. If the freshly loaded build still can't fetch the chunk
	// the cause isn't staleness (an offline client, a broken CDN object), and
	// reloading again would spin the tab instead of surfacing the error.
	try {
		if (window.sessionStorage.getItem(RELOAD_MARKER_KEY) !== null) return false;
		window.sessionStorage.setItem(RELOAD_MARKER_KEY, "1");
	} catch {
		// Private mode / storage disabled: without a marker a reload could loop,
		// so report the error instead.
		return false;
	}

	window.location.reload();
	return true;
}

/**
 * Clears the one-shot marker once the app has rendered successfully, so a later
 * deploy gets its own reload rather than being reported as unrecoverable.
 */
export function clearStaleChunkMarker(): void {
	if (typeof window === "undefined") return;
	try {
		window.sessionStorage.removeItem(RELOAD_MARKER_KEY);
	} catch {
		// Nothing to clear when storage is unavailable.
	}
}
