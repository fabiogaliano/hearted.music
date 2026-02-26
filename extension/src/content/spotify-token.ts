const EVENT_NAME = "__hearted_token";

window.addEventListener(EVENT_NAME, ((event: CustomEvent) => {
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

console.log("[hearted.] Content script loaded — listening for tokens");
