import { spawn, type ChildProcess } from "node:child_process";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "url";
import { defineConfig, loadEnv, type Plugin } from "vite";
import viteTsConfigPaths from "vite-tsconfig-paths";

const isTest = process.env.VITEST === "true";

// Load env files for tests (Vitest doesn't auto-load non-VITE_ prefixed vars)
if (isTest) {
	const env = loadEnv("test", process.cwd(), "");
	Object.assign(process.env, env);
}

function embeddingSidecarPlugin(): Plugin {
	let child: ChildProcess | null = null;

	return {
		name: "embedding-sidecar",
		configureServer(server) {
			if (process.env.ML_PROVIDER !== "local") return;

			const port = process.env.EMBEDDING_SERVER_PORT || "9847";
			const baseUrl = `http://127.0.0.1:${port}`;

			// Don't start if already running (e.g. user started it manually)
			fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1000) })
				.then((res) => {
					if (res.ok)
						console.log(
							"[Embedding Sidecar] Already running, skipping auto-start",
						);
				})
				.catch(() => {
					child = spawn("bun", ["scripts/dev-embedding-sidecar.ts"], {
						stdio: "inherit",
						cwd: process.cwd(),
					});
					child.on("error", (err) => {
						console.error("[Embedding Sidecar] Failed to start:", err.message);
						child = null;
					});
				});

			const cleanup = () => {
				if (child) {
					child.kill();
					child = null;
				}
			};
			server.httpServer?.on("close", cleanup);
			process.on("SIGINT", cleanup);
			process.on("SIGTERM", cleanup);
		},
	};
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
		cors: {
			origin: true,
			methods: ["GET", "POST", "OPTIONS"],
			allowedHeaders: ["Authorization", "Content-Type"],
		},
	},
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
		},
	},
	plugins: [
		embeddingSidecarPlugin(),
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
