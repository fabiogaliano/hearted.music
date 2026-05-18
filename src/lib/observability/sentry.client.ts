import type { AnyRouter } from "@tanstack/router-core";
import * as Sentry from "@sentry/react";
import { clientEnv } from "@/env.client";

export const RUNTIME_TAG = "web" as const;

type CaptureContext = {
	route?: string;
	[key: string]: unknown;
};

let sentryInitialized = false;

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

	const integrations = [
		Sentry.tanstackRouterBrowserTracingIntegration(router),
		...(import.meta.env.PROD ? [Sentry.replayIntegration()] : []),
	];

	Sentry.init({
		dsn: clientEnv.VITE_SENTRY_DSN,
		environment: clientEnv.VITE_SENTRY_ENVIRONMENT ?? import.meta.env.MODE,
		// Same-origin tunnel sidesteps ad-blockers in both dev and prod.
		tunnel: "/api/sentry-tunnel",
		integrations,
		tracesSampleRate: 0.05,
		replaysSessionSampleRate: 0.01,
		replaysOnErrorSampleRate: 1.0,
		sendDefaultPii: false,
		enableLogs: false,
		initialScope: { tags: { runtime: RUNTIME_TAG } },
	});
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
