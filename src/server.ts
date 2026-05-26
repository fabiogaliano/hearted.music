import * as Sentry from "@sentry/cloudflare";
import handler, { createServerEntry } from "@tanstack/react-start/server-entry";

interface WorkerEnv {
	SENTRY_DSN?: string;
	SENTRY_ENVIRONMENT?: string;
	[key: string]: unknown;
}

// Defensive try/catch around handler.fetch. withSentry's automatic exception
// capture is unreliable when wrapping createServerEntry (TanStack's framework
// layers can swallow throws or surface them in shapes withSentry doesn't see).
// An explicit captureException here is the reliable backstop; if withSentry
// also catches, Sentry dedupes by event ID.
const entry = createServerEntry({
	async fetch(request: Request) {
		try {
			return await handler.fetch(request);
		} catch (err) {
			Sentry.captureException(err, { tags: { source: "server-entry" } });
			throw err;
		}
	},
});

export default Sentry.withSentry(
	(env: WorkerEnv) => ({
		dsn: env.SENTRY_DSN,
		environment: env.SENTRY_ENVIRONMENT ?? "production",
		// Vite inlines this at build, matching the browser + sourcemap release.
		release: import.meta.env.VITE_APP_RELEASE,
		tracesSampleRate: 0.05,
		sendDefaultPii: false,
		enableLogs: false,
		initialScope: { tags: { runtime: "web-server" } },
	}),
	entry,
);
