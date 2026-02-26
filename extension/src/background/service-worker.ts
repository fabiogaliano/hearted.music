chrome.runtime.onInstalled.addListener((details) => {
	console.log("[hearted.] Extension installed:", details.reason);
});
