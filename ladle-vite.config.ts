import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "url";
import { defineConfig } from "vite";

// Do NOT add @vitejs/plugin-react here. The root project's `vite` is
// rolldown-vite (depends on `rolldown`), and the matching
// @vitejs/plugin-react@6 registers a rolldown builtin
// (`vite-react-refresh-wrapper`) that crashes inside Ladle's bundled
// Rollup-based Vite 6 with "Missing field `moduleType`".
// Ladle auto-injects @vitejs/plugin-react-swc when no React plugin is
// present in this config — that's the path we want.
// See https://github.com/tajo/ladle/issues/623
export default defineConfig({
	plugins: [tailwindcss()],
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
