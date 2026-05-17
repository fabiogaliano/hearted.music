import * as Sentry from "@sentry/bun";

const dsn = process.env.SENTRY_DSN;

if (dsn) {
	Sentry.init({
		dsn,
		environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
		tracesSampleRate: 0.01,
		sendDefaultPii: false,
		enableLogs: false,
		initialScope: { tags: { runtime: "worker" } },
	});
}
