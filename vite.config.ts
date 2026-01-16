import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "url";
import { defineConfig } from "vite";
import viteTsConfigPaths from "vite-tsconfig-paths";

const isTest = process.env.VITEST === "true";

const config = defineConfig({
	test: {
		environment: "jsdom",
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
		// Skip Cloudflare and TanStack Start plugins during tests - they use workers
		// that can't handle CommonJS modules like tiny-warning
		!isTest && cloudflare({ viteEnvironment: { name: "ssr" } }),
		viteTsConfigPaths({
			projects: ["./tsconfig.json"],
		}),
		tailwindcss(),
		// @ts-expect-error - preset exists at runtime but missing from types
		!isTest && tanstackStart({ preset: "node-ws" }),
		viteReact(),
	].filter(Boolean),
});

export default config;
