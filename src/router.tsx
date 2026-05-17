import * as Sentry from "@sentry/react";
import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { createIsomorphicFn } from "@tanstack/react-start";
import { env } from "./env";
import { getContext } from "./integrations/tanstack-query/root-provider";

import { routeTree } from "./routeTree.gen";

let sentryInitialized = false;

const getSSROptions = createIsomorphicFn().server(() => {
	const array = new Uint8Array(16);
	crypto.getRandomValues(array);
	const nonce = Array.from(array, (b) => b.toString(16).padStart(2, "0")).join(
		"",
	);
	return { nonce };
});

export const getRouter = () => {
	const rqContext = getContext();

	const router = createRouter({
		routeTree,
		context: {
			...rqContext,
		},
		defaultPreload: "intent",
		ssr: getSSROptions(),
	});

	setupRouterSsrQueryIntegration({
		router,
		queryClient: rqContext.queryClient,
	});

	if (!router.isServer && !sentryInitialized && env.VITE_SENTRY_DSN) {
		sentryInitialized = true;
		Sentry.init({
			dsn: env.VITE_SENTRY_DSN,
			environment: env.VITE_SENTRY_ENVIRONMENT ?? import.meta.env.MODE,
			// Same-origin tunnel sidesteps ad-blockers in both dev and prod.
			tunnel: "/api/sentry-tunnel",
			integrations: [
				Sentry.tanstackRouterBrowserTracingIntegration(router),
				Sentry.replayIntegration(),
			],
			tracesSampleRate: 0.05,
			replaysSessionSampleRate: 0.01,
			replaysOnErrorSampleRate: 1.0,
			sendDefaultPii: false,
			enableLogs: false,
			initialScope: { tags: { runtime: "web" } },
		});
	}

	return router;
};
