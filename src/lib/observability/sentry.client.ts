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
		// Same-origin tunnel sidesteps ad-blockers in both dev and prod.
		tunnel: "/api/sentry-tunnel",
		integrations: [Sentry.tanstackRouterBrowserTracingIntegration(router)],
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
