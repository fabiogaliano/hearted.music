import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "url";
import { defineConfig, loadEnv } from "vite";
import viteTsConfigPaths from "vite-tsconfig-paths";

const isTest = process.env.VITEST === "true";

// Load env files for tests (Vitest doesn't auto-load non-VITE_ prefixed vars)
if (isTest) {
	const env = loadEnv("test", process.cwd(), "");
	Object.assign(process.env, env);
}

const config = defineConfig({
	test: {
		environment: "jsdom",
		setupFiles: ["./src/test/setup.tsx"],
		exclude: ["**/node_modules/**", "**/old_app/**"],
		server: {
			deps: {
				inline: ["tiny-warning"],
			},
		},
	},
	server: {
		host: "127.0.0.1",
		port: 5173,
	},
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
		},
	},
	plugins: [
		devtools(),
		viteTsConfigPaths({
			projects: ["./tsconfig.json"],
		}),
		tailwindcss(),
		// Cloudflare must come BEFORE tanstackStart per Cloudflare docs:
		// https://developers.cloudflare.com/changelog/2025-10-24-tanstack-start/
		!isTest && cloudflare({ viteEnvironment: { name: "ssr" } }),
		// @ts-expect-error - preset exists at runtime but missing from types
		!isTest && tanstackStart({ preset: "node-ws" }),
		viteReact(),
	].filter(Boolean),
});

export default config;
