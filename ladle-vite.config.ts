import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "url";
import { defineConfig } from "vite";

// We use @vitejs/plugin-react here (same as the app). Our forked Ladle
// bundles Vite 8 (Rolldown), matching the app's engine, so plugin-react@6's
// Rolldown refresh builtin loads fine. On upstream Ladle (Rollup-based Vite 6)
// this crashed with "Missing field `moduleType`" and we had to omit it and let
// Ladle auto-inject @vitejs/plugin-react-swc instead. See tajo/ladle#623.
export default defineConfig({
	plugins: [react(), tailwindcss()],
	optimizeDeps: {
		exclude: ["@tanstack/react-start/server"],
	},
	resolve: {
		alias: [
			// Stub server-only modules that can't run in the browser.
			// TanStack Start's Vite plugin normally strips these from client
			// bundles, but Ladle doesn't run that plugin.
			{
				find: "@tanstack/react-start/server",
				replacement: fileURLToPath(
					new URL(
						"./src/__mocks__/tanstack-react-start-server.stub.ts",
						import.meta.url,
					),
				),
			},
			// `cloudflare:workers` is a workerd-only runtime module that
			// @cloudflare/vite-plugin provides in the app build. Ladle doesn't run
			// that plugin, so the dep scanner can't resolve the dynamic import in
			// auth-request-state.ts. Reuse the test stub (no-op waitUntil, empty env).
			{
				find: "cloudflare:workers",
				replacement: fileURLToPath(
					new URL("./src/test/cloudflare-workers.stub.ts", import.meta.url),
				),
			},
			// TanStack Start's start-storage-context runs `new AsyncLocalStorage()`
			// at module load. The app build strips that server module via the Start
			// Vite plugin, but Ladle doesn't run it — so the module reaches the
			// browser, where Vite externalizes node:async_hooks to a stub whose
			// AsyncLocalStorage isn't constructable, crashing any story that imports
			// a server function. This shim makes construction a no-op; handlers are
			// RPC callers that never execute in Ladle, so run/getStore stay unused.
			{
				find: "node:async_hooks",
				replacement: fileURLToPath(
					new URL("./src/test/async-hooks.stub.ts", import.meta.url),
				),
			},
			// Every server function attaches authMiddleware, whose .server() body
			// pulls better-auth (and its Node `Buffer` usage) into the browser.
			// Stubbing the middleware cuts that graph for all server functions at
			// once, so individual function modules can bundle harmlessly.
			{
				find: /^@\/lib\/platform\/auth\/auth\.middleware$/,
				replacement: fileURLToPath(
					new URL("./src/__mocks__/auth.middleware.stub.ts", import.meta.url),
				),
			},
			// Server function modules that transitively pull in Node.js-only
			// packages (better-auth, postgres, drizzle) via the auth chain.
			{
				find: /^@\/lib\/server\/billing\.functions$/,
				replacement: fileURLToPath(
					new URL("./src/__mocks__/billing.functions.stub.ts", import.meta.url),
				),
			},
			{
				find: /^@\/lib\/server\/onboarding\.functions$/,
				replacement: fileURLToPath(
					new URL(
						"./src/__mocks__/onboarding.functions.stub.ts",
						import.meta.url,
					),
				),
			},
			// playlists.functions pulls drizzle/postgres into the graph via its
			// server-fn handlers. The playlist detail stories reach it through the
			// genre quick-picks query + pills autosave hook; the stub cuts that chain.
			{
				find: /^@\/lib\/server\/playlists\.functions$/,
				replacement: fileURLToPath(
					new URL(
						"./src/__mocks__/playlists.functions.stub.ts",
						import.meta.url,
					),
				),
			},
			// ClaimHandleStep's availability/claim RPCs. The stub is controllable so
			// its stories can drive every availability state (see the stub header).
			{
				find: /^@\/lib\/server\/account-handle\.functions$/,
				replacement: fileURLToPath(
					new URL(
						"./src/__mocks__/account-handle.functions.stub.ts",
						import.meta.url,
					),
				),
			},
			// Playlist draft preview engine + commit path: pulls drizzle/postgres/supabase
			// via the auth chain. Stubbed so create-flow stories render with fixture data.
			{
				find: /^@\/lib\/server\/playlist-draft\.functions$/,
				replacement: fileURLToPath(
					new URL(
						"./src/__mocks__/playlist-draft.functions.stub.ts",
						import.meta.url,
					),
				),
			},
			// Intent eligibility server function pulls auth + billing tables.
			// Stub exposes a controllable boolean (premium vs free).
			{
				find: /^@\/features\/playlists\/create\/intentEligibility$/,
				replacement: fileURLToPath(
					new URL(
						"./src/__mocks__/intentEligibility.stub.ts",
						import.meta.url,
					),
				),
			},
			// The extension orchestrator calls the real Spotify extension — no-op in Ladle.
			{
				find: /^@\/lib\/extension\/create-playlist-from-draft$/,
				replacement: fileURLToPath(
					new URL(
						"./src/__mocks__/create-playlist-from-draft.stub.ts",
						import.meta.url,
					),
				),
			},
			{
				find: "@",
				replacement: fileURLToPath(new URL("./src", import.meta.url)),
			},
		],
	},
});
