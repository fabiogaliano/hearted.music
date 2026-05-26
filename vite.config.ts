import { type ChildProcess, spawn } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import { sentryTanstackStart } from "@sentry/tanstackstart-react/vite";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

const isTest = process.env.VITEST === "true";
const isLiveTest = process.env.VITEST_LIVE === "true";
const isRelease = process.env.RELEASE === "true";
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;

const liveTestExcludes = [
	"**/analysis-pipeline-full-flow.integration.test.ts",
	"**/lyrics-service.integration.test.ts",
	"**/playlist-profiling-integration.test.ts",
];

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

export default defineConfig(({ command }) => {
	// Use Vite's `command` rather than process.env.NODE_ENV: Vite sets it
	// itself, so the prod-only route filter can't silently miss when the
	// shell didn't export NODE_ENV.
	const isBuild = command === "build";

	if (isBuild && isRelease && !sentryAuthToken) {
		throw new Error(
			"RELEASE=true build requires SENTRY_AUTH_TOKEN so Sentry source maps upload with the production bundle.",
		);
	}

	// getPostHogConfig() throws at SSR render when this token is missing in a
	// prod bundle, 500ing every page. Fail the release build instead so a
	// missing token surfaces in CI, not in users' browsers. Host is optional —
	// resolvePostHogHosts defaults to EU when unset.
	if (isBuild && isRelease && !process.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN) {
		throw new Error(
			"RELEASE=true build requires VITE_PUBLIC_POSTHOG_PROJECT_TOKEN; getPostHogConfig() 500s every page without it.",
		);
	}

	const useUipaneStub = isBuild || isTest;

	return {
		test: {
			environment: "jsdom",
			setupFiles: ["./src/test/setup.tsx"],
			exclude: [
				"**/node_modules/**",
				"**/old_app/**",
				// Sibling Hono service mounted via symlink; runs from its own root.
				"**/v1_hearted_brand/**",
				// Live-stack E2E suite — run via `bun run test:e2e`, not Vitest.
				"**/tests/e2e/**",
				// Opt-in live integration tests — run via `bun run test:live`.
				...(!isLiveTest ? liveTestExcludes : []),
			],
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
			tsconfigPaths: true,
			alias: {
				// `cloudflare:workers` is a workerd-only runtime module Vite can't
				// resolve under Vitest; point it at a stub so server code that imports
				// it stays transformable. Test-only — production resolves the real
				// module via @cloudflare/vite-plugin.
				...(isTest
					? {
							"cloudflare:workers": fileURLToPath(
								new URL(
									"./src/test/cloudflare-workers.stub.ts",
									import.meta.url,
								),
							),
						}
					: {}),
				// CI may not have the local `file:../../uipane` package. Build/test use
				// the internal stub so dev-only pane wiring never ships or blocks verify.
				...(useUipaneStub
					? {
							"@/integrations/uipane": fileURLToPath(
								new URL("./src/integrations/uipane.stub.ts", import.meta.url),
							),
						}
					: {}),
				"@": fileURLToPath(new URL("./src", import.meta.url)),
			},
		},
		plugins: [
			embeddingSidecarPlugin(),
			!isBuild && devtools(),
			tailwindcss(),
			// Cloudflare must come BEFORE tanstackStart per Cloudflare docs:
			// https://developers.cloudflare.com/changelog/2025-10-24-tanstack-start/
			!isTest && cloudflare({ viteEnvironment: { name: "ssr" } }),
			!isTest &&
				tanstackStart({
					// @ts-expect-error - preset exists at runtime but missing from types
					preset: "node-ws",
					router: {
						routeFileIgnorePattern: isBuild
							? "^dev-|\\.test\\.(ts|tsx)$"
							: "\\.test\\.(ts|tsx)$",
					},
				}),
			viteReact(),
			// Sentry must come last so it sees the final bundle for source map upload.
			// Release builds fail fast when the auth token is missing instead of
			// silently shipping unreadable production stack traces.
			// Tunneling is handled by our own `/api/sentry-tunnel` file route, not
			// the plugin — same mechanism dev and prod, no auth-token gating.
			!isTest &&
				isRelease &&
				sentryTanstackStart({
					org: "f-inc",
					project: "hearted-music",
					authToken: sentryAuthToken,
					// Pin to the inlined SHA so sourcemaps resolve; else git auto-detect.
					release: { name: process.env.VITE_APP_RELEASE },
				}),
		].filter(Boolean),
	};
});
