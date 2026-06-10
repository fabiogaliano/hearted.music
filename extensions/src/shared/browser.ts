// Single entry point for the extension's WebExtension API calls.
//
// Firefox exposes a promise-native `browser.*` namespace; Chrome MV3 exposes a
// promise-native `chrome.*` namespace. Both satisfy the `@types/chrome` surface
// this extension uses, so extension-context code imports `browser` from here
// and stays runtime-agnostic. (Content scripts that run in the page's MAIN
// world — e.g. intercept-token.ts — touch no extension APIs and must NOT import
// this.)
//
// Resolution is lazy (via Proxy) rather than captured once at module-eval time.
// The test suites install or swap the global `chrome` mock per test — some in a
// `beforeEach` that runs *after* the module under test is imported. A snapshot
// shim would bind whatever existed at first import (usually `undefined` under
// vitest) and never observe those reassignments; the Proxy re-reads the global
// on every access, so each test sees its own mock.

type WebExtApi = typeof chrome;

function resolveApi(): WebExtApi {
	const globals = globalThis as { browser?: WebExtApi; chrome?: WebExtApi };
	const api = globals.browser ?? globals.chrome;
	if (!api) {
		throw new Error(
			"[hearted.] No WebExtension API available (neither browser nor chrome is defined)",
		);
	}
	return api;
}

export const browser: WebExtApi = new Proxy({} as WebExtApi, {
	get(_target, prop) {
		const api = resolveApi();
		return Reflect.get(api as object, prop, api);
	},
	has(_target, prop) {
		return Reflect.has(resolveApi() as object, prop);
	},
});
