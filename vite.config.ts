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
const isRelease = process.env.RELEASE === "true";
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;

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
					// CSRF is handled by SameSite=lax session cookies + Better Auth's
					// originCheckMiddleware. Audited 2026-05; see src/start.ts.
					serverFns: {
						disableCsrfMiddlewareWarning: true,
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
				}),
		].filter(Boolean),
	};
});
