const TOKEN_EVENT = "__hearted_token";
const HASH_EVENT = "__hearted_hash";

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

console.log(
	"[hearted.] Content script loaded — listening for tokens and hashes",
);
