const SPOTIFY_DOMAINS = ["spotify.com", "spclient.spotify.com"];
const EVENT_NAME = "__hearted_token";

const origFetch = window.fetch;
let lastToken: string | null = null;

function isSpotifyUrl(url: string): boolean {
	try {
		const { hostname } = new URL(url);
		return SPOTIFY_DOMAINS.some((d) => hostname.endsWith(d));
	} catch {
		return false;
	}
}

window.fetch = function (...args: Parameters<typeof fetch>) {
	const [input, init] = args;
	const url =
		typeof input === "string"
			? input
			: input instanceof Request
				? input.url
				: "";

	if (init?.headers) {
		let auth: string | null = null;
		if (init.headers instanceof Headers) {
			auth = init.headers.get("Authorization");
		} else if (Array.isArray(init.headers)) {
			const pair = init.headers.find(
				([k]) => k.toLowerCase() === "authorization",
			);
			if (pair) auth = pair[1];
		} else if (typeof init.headers === "object") {
			auth =
				(init.headers as Record<string, string>)["Authorization"] ||
				(init.headers as Record<string, string>)["authorization"] ||
				null;
		}

		if (
			auth &&
			auth.startsWith("Bearer ") &&
			auth !== lastToken &&
			isSpotifyUrl(url)
		) {
			lastToken = auth;
			window.dispatchEvent(
				new CustomEvent(EVENT_NAME, {
					detail: { accessToken: auth.substring(7) },
				}),
			);
		}
	}
	return origFetch.apply(this, args);
};

// Also log all pathfinder requests and dispatch hash update events
const pfLog: Array<{ op: string; hash: string; vars: string }> = [];
(window as any).__pfLog = pfLog;

const HASH_EVENT_NAME = "__hearted_hash";
const lastSeenHashes = new Map<string, string>();

const tokenFetch = window.fetch;
window.fetch = function (...args: Parameters<typeof fetch>) {
	const [input, init] = args;
	const url =
		typeof input === "string"
			? input
			: input instanceof Request
				? input.url
				: "";

	if (
		url.includes("pathfinder") &&
		init?.body &&
		typeof init.body === "string"
	) {
		try {
			const parsed = JSON.parse(init.body);
			const op = parsed.operationName || "unknown";
			const hash = parsed.extensions?.persistedQuery?.sha256Hash || "none";
			const vars = JSON.stringify(parsed.variables || {}).substring(0, 300);

			pfLog.push({ op, hash, vars });
			console.log(
				`[hearted.pf] ${op} | ${hash.substring(0, 16)}... | ${vars.substring(0, 100)}`,
			);

			if (hash !== "none" && lastSeenHashes.get(op) !== hash) {
				lastSeenHashes.set(op, hash);
				window.dispatchEvent(
					new CustomEvent(HASH_EVENT_NAME, {
						detail: { operationName: op, sha256Hash: hash },
					}),
				);
			}
		} catch {}
	}
	return tokenFetch.apply(this, args);
};

console.log("[hearted.] Fetch interceptor installed (with pathfinder logging)");
