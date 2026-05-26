import * as Sentry from "@sentry/bun";
import { initPostHogOtel } from "./posthog-otel";

const dsn = process.env.SENTRY_DSN;

if (dsn) {
	Sentry.init({
		dsn,
		environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
		// Undefined until Coolify passes APP_RELEASE (H14); Sentry omits it meanwhile.
		release: process.env.APP_RELEASE,
		tracesSampleRate: 0.01,
		sendDefaultPii: false,
		enableLogs: false,
		initialScope: { tags: { runtime: "worker" } },
	});
}

initPostHogOtel();
