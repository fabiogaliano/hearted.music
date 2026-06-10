const TOKEN_EVENT = "__hearted_token";
const HASH_EVENT = "__hearted_hash";
// MUST stay in sync with src/lib/extension/reconnect-link.ts.
const ARM_TOKEN_FRAGMENT_PARAM = "hearted-arm";

window.addEventListener(TOKEN_EVENT, ((event: CustomEvent) => {
	const { accessToken } = event.detail;
	if (!accessToken) return;

	const payload = {
		accessToken,
		expiresAtMs: Date.now() + 55 * 60 * 1000,
		isAnonymous: false,
	};

	try {
		chrome.runtime.sendMessage({ type: "SPOTIFY_TOKEN", payload });
		console.log("[hearted.] Token captured and sent to background");
	} catch {
		// Extension context invalidated
	}
}) as EventListener);

window.addEventListener(HASH_EVENT, ((event: CustomEvent) => {
	const { operationName, sha256Hash } = event.detail;
	if (!operationName || !sha256Hash) return;

	try {
		chrome.runtime.sendMessage({
			type: "PATHFINDER_HASH",
			payload: { operationName, sha256Hash },
		});
	} catch {
		// Extension context invalidated
	}
}) as EventListener);

// Report any `hearted-arm` fragment param to the background. This is the
// per-mount arm token minted by SpotifyReconnectLink and embedded in the URL
// that opened this tab; the background uses it as provenance to dual-match
// SPOTIFY_TOKEN events. Only the exact tab opened from the reconnect link
// will carry the matching token.
function readArmTokenFromHash(hash: string): string | null {
	const stripped = hash.startsWith("#") ? hash.slice(1) : hash;
	if (stripped.length === 0) return null;
	try {
		const params = new URLSearchParams(stripped);
		const token = params.get(ARM_TOKEN_FRAGMENT_PARAM);
		return token && token.length > 0 ? token : null;
	} catch {
		return null;
	}
}

function reportArmTokenIfPresent(): void {
	const token = readArmTokenFromHash(window.location.hash);
	if (token === null) return;
	try {
		chrome.runtime.sendMessage({ type: "ARM_TOKEN_PRESENT", token });
	} catch {
		// Extension context invalidated
	}
}

reportArmTokenIfPresent();
window.addEventListener("hashchange", reportArmTokenIfPresent);

console.log(
	"[hearted.] Content script loaded — listening for tokens and hashes",
);
