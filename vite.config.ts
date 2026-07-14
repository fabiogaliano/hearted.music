import { type ChildProcess, spawn } from "node:child_process";
import os from "node:os";
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

// Vitest defaults to roughly one worker per core; with `pool: "threads"` every
// worker transforms and runs in parallel, which spikes CPU to 100% at startup.
// Half the cores is the measured sweet spot: on an 8-core machine, going above
// half buys ~nothing (6 vs 4 workers was within 4%) while dropping below it is
// costly (3 workers +28%, 2 workers +84%). Override with VITEST_MAX_WORKERS —
// `bun run test` pins it to 2 so the default local run stays responsive, while
// `bun run test:fast` (used in CI) takes the half-core throughput.
const availableCores = os.availableParallelism?.() ?? os.cpus().length;
const testMaxWorkers = process.env.VITEST_MAX_WORKERS
	? Math.max(1, Number(process.env.VITEST_MAX_WORKERS))
	: Math.max(1, Math.floor(availableCores / 2));
const isRelease = process.env.RELEASE === "true";
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;

const liveTestExcludes = [
	"**/analysis-pipeline-full-flow.integration.test.ts",
	"**/lyrics-service.integration.test.ts",
	"**/playlist-profiling-integration.test.ts",
];

const sharedTestExcludes = [
	"**/node_modules/**",
	// Agent worktree isolation checks out full repo copies under .claude/worktrees;
	// scanning them double-runs every test and collides on shared local-DB fixtures.
	"**/.claude/**",
	"**/old_app/**",
	// Sibling Hono service mounted via symlink; runs from its own root.
	"**/v1_hearted_brand/**",
	// Live-stack E2E suite — run via `bun run test:e2e`, not Vitest.
	"**/tests/e2e/**",
	// Opt-in live integration tests — run via `bun run test:live`.
	...(!isLiveTest ? liveTestExcludes : []),
];

// .test.ts files that need a DOM (renderHook, document/window APIs) despite the
// non-tsx extension. Routed to the jsdom project; everything else .test.ts runs
// in the much cheaper node environment.
const domTestFiles = [
	"src/features/onboarding/__tests__/useStepNavigation.test.ts",
	"src/features/onboarding/__tests__/demoSandboxStore.test.ts",
	"src/features/billing/__tests__/useCheckoutFlow.test.ts",
	"src/lib/extension/__tests__/reconnect-link.test.ts",
	"src/lib/consent/__tests__/consent-storage.test.ts",
	"src/lib/extension/__tests__/useSpotifyReconnectState.test.ts",
	"src/features/playlists/create/__tests__/useSpotifyGate.test.ts",
	"src/features/playlists/create/__tests__/usePublishPlaylist.test.ts",
	"src/features/playlists/__tests__/usePlaylistVoices.test.ts",
	"src/lib/extension/__tests__/transport.test.ts",
	// useActiveJobs hook tests use renderHook and require a DOM environment.
	"src/lib/hooks/__tests__/useActiveJobs.test.ts",
];

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
					child = spawn("bun", ["scripts/dev/dev-embedding-sidecar.ts"], {
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
			// CI has no .env files, so seed placeholders as fallbacks; loadEnv
			// values (real local secrets) spread last and win over these defaults.
			// node tests set isServer:true in env.ts so t3-env validates the server
			// schema at import — these vars must be present before any module loads.
			// Host must NOT look local: security-invariants.integration.test.ts
			// runs only when DATABASE_URL points at localhost/127.0.0.1.
			env: isTest
				? {
						SUPABASE_URL: "http://localhost:54321",
						SUPABASE_ANON_KEY: "test-anon-key",
						SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
						BETTER_AUTH_SECRET: "test-better-auth-secret-0000000000000000",
						BETTER_AUTH_URL: "http://localhost:3000",
						DATABASE_URL:
							"postgresql://placeholder:placeholder@db.placeholder.test:5432/placeholder",
						VITE_PUBLIC_APP_ORIGIN: "https://hearted.music",
						...loadEnv("test", process.cwd(), ""),
					}
				: {},
			// Threads spawn faster than the default forks pool and these suites have
			// no fork-only needs (no process.exit, no native addons requiring process
			// isolation); verified stable across repeated runs.
			pool: "threads",
			// Cap concurrency so the run doesn't saturate every core at once. See
			// testMaxWorkers above for the rationale and the CI override.
			maxWorkers: testMaxWorkers,
			minWorkers: 1,
			// Two projects split by environment cost: jsdom is initialized per file
			// and dominates total runtime, so only the ~25 files that touch a DOM pay
			// for it. The other ~90 run in the much cheaper node environment.
			projects: [
				{
					extends: true,
					test: {
						name: "node",
						environment: "node",
						include: ["**/*.test.ts"],
						exclude: [...sharedTestExcludes, ...domTestFiles],
						setupFiles: ["./src/test/setup.node.ts"],
						server: { deps: { inline: ["tiny-warning"] } },
					},
				},
				{
					extends: true,
					test: {
						name: "dom",
						environment: "jsdom",
						include: ["**/*.test.tsx", ...domTestFiles],
						exclude: sharedTestExcludes,
						setupFiles: ["./src/test/setup.tsx"],
						server: { deps: { inline: ["tiny-warning"] } },
					},
				},
			],
		},
		// Pre-bundle deps Vite would otherwise discover mid-request. The first SSR
		// request to reference one (e.g. @sentry/cloudflare) triggers an optimizer
		// re-run, which restarts the @cloudflare/vite-plugin workerd runner and
		// drops any in-flight request with "Network connection lost". Declaring
		// them bundles at startup so the runner never restarts under load. `ssr`
		// covers the workerd SSR environment (the deps_ssr optimizer); the
		// top-level block covers the client. Add any package named in a
		// `[optimizer] bundling` dev log.
		//
		// The client list must cover every dep reachable from route chunks, not
		// just the root entry: TanStack Start code-splits routes, so the initial
		// crawl never sees deps imported only by lazy route modules. Each one
		// discovered on first navigation forces a client re-optimize + full page
		// reload ("optimized dependencies changed"), which shows up as constant
		// blinking/flashing while browsing in dev.
		optimizeDeps: {
			include: [
				"@sentry/cloudflare",
				"@sentry/tanstackstart-react",
				"@sentry/react",
				"react",
				"react-dom",
				"react-dom/client",
				"@tanstack/react-query",
				"@tanstack/react-router",
				"@tanstack/react-router-ssr-query",
				"@tanstack/react-start",
				"@tanstack/react-devtools",
				"@tanstack/react-query-devtools",
				"@tanstack/react-router-devtools",
				"@phosphor-icons/react",
				"@number-flow/react",
				"framer-motion",
				"gsap",
				"@gsap/react",
				"sonner",
				"zod",
				"clsx",
				"tailwind-merge",
				"better-result",
				"@supabase/supabase-js",
				"posthog-js",
				"@posthog/react",
				"better-auth/react",
				"better-auth/tanstack-start",
			],
		},
		ssr: {
			optimizeDeps: {
				include: ["@sentry/cloudflare", "@sentry/tanstackstart-react"],
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
