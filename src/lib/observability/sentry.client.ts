import * as Sentry from "@sentry/react";
import type { AnyRouter } from "@tanstack/router-core";
import { clientEnv } from "@/env.public";

export const RUNTIME_TAG = "web" as const;

type CaptureContext = {
	route?: string;
	[key: string]: unknown;
};

let sentryInitialized = false;
let replayIntegration: ReturnType<typeof Sentry.replayIntegration> | null =
	null;

function isSentryEnabled(): boolean {
	return (
		typeof window !== "undefined" && clientEnv.VITE_SENTRY_DSN !== undefined
	);
}

export function initSentry(router: AnyRouter): void {
	if (!isSentryEnabled() || sentryInitialized) {
		return;
	}

	sentryInitialized = true;

	// Error monitoring only. No cookies, sendDefaultPii:false, no session
	// replay — this is our legitimate-interest baseline that may run before
	// consent. The replay integration is added later via enableSentryReplay()
	// once the user opts in (it records the DOM, which EU DPAs treat as
	// personal data requiring consent).
	Sentry.init({
		dsn: clientEnv.VITE_SENTRY_DSN,
		environment: clientEnv.VITE_SENTRY_ENVIRONMENT ?? import.meta.env.MODE,
		// Must match the plugin's sourcemap release or prod traces stay minified.
		release: clientEnv.VITE_APP_RELEASE,
		// Same-origin tunnel sidesteps ad-blockers in both dev and prod. The path is
		// deliberately neutral ("pulse-s", not "sentry-tunnel"): blocker filter lists
		// match "sentry" by substring, so a same-origin proxy named for the vendor
		// still gets ERR_BLOCKED_BY_CLIENT. Sibling of PostHog's "/api/pulse-h" but a
		// distinct path, so one filter rule can't blind both analytics and errors.
		tunnel: "/api/pulse-s",
		integrations: [
			Sentry.tanstackRouterBrowserTracingIntegration(router),
			// Default lifecycle is "route": browserSessionIntegration sends a fresh
			// session envelope on every soft navigation, which floods the tunnel for
			// an active SPA user. "page" keeps release-health (one session per hard
			// load) without the per-navigation envelope storm — the real cause of
			// the tunnel 429s.
			Sentry.browserSessionIntegration({ lifecycle: "page" }),
		],
		// Drop errors thrown inside third-party widget bundles (e.g. UserJot's
		// SDK retrying a failed identify) — they aren't ours to fix and would
		// otherwise flood the tunnel and our error budget.
		denyUrls: [/userjot\.com/i],
		tracesSampleRate: 0.05,
		// Replay sample rates are honored once the integration is added on
		// consent; they're inert until then.
		replaysSessionSampleRate: 0.01,
		replaysOnErrorSampleRate: 1.0,
		sendDefaultPii: false,
		enableLogs: false,
		initialScope: { tags: { runtime: RUNTIME_TAG } },
	});
}

export function enableSentryReplay(): void {
	if (
		!isSentryEnabled() ||
		!sentryInitialized ||
		!import.meta.env.PROD ||
		replayIntegration !== null
	) {
		return;
	}

	replayIntegration = Sentry.replayIntegration();
	Sentry.addIntegration(replayIntegration);
}

export function disableSentryReplay(): void {
	if (replayIntegration === null) return;

	// stop() halts recording and flushes for the rest of this page life. A
	// fresh page load won't re-add the integration unless consent is granted
	// again, so withdrawal is durable.
	void replayIntegration.stop();
	replayIntegration = null;
}

export function captureRouteError(
	error: unknown,
	context: CaptureContext = {},
): void {
	if (!isSentryEnabled() || !sentryInitialized) {
		return;
	}

	Sentry.captureException(error, {
		tags: {
			runtime: RUNTIME_TAG,
			...(context.route ? { route: context.route } : {}),
		},
		contexts: { route: context },
	});
}
