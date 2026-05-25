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
			{
				find: "@",
				replacement: fileURLToPath(new URL("./src", import.meta.url)),
			},
		],
	},
});
