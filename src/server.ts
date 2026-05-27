import * as Sentry from "@sentry/cloudflare";
import handler, { createServerEntry } from "@tanstack/react-start/server-entry";

interface WorkerEnv {
	SENTRY_DSN?: string;
	SENTRY_ENVIRONMENT?: string;
	[key: string]: unknown;
}

function validateSentryEnv(env: WorkerEnv): {
	dsn?: string;
	environment: string;
} {
	const rawEnvironment = env.SENTRY_ENVIRONMENT;
	if (rawEnvironment !== undefined && typeof rawEnvironment !== "string") {
		throw new Error("SENTRY_ENVIRONMENT must be a string when provided");
	}
	const environment =
		typeof rawEnvironment === "string" && rawEnvironment.trim().length > 0
			? rawEnvironment.trim()
			: "production";

	const dsn = env.SENTRY_DSN;
	if (dsn === undefined || dsn === "") {
		return { environment };
	}
	if (typeof dsn !== "string") {
		throw new Error("SENTRY_DSN must be a string when provided");
	}

	try {
		new URL(dsn);
	} catch {
		throw new Error("SENTRY_DSN must be a valid URL");
	}

	return { dsn, environment };
}

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

export default Sentry.withSentry((env: WorkerEnv) => {
	const sentryConfig = validateSentryEnv(env);
	return {
		dsn: sentryConfig.dsn,
		environment: sentryConfig.environment,
		release: import.meta.env.VITE_APP_RELEASE,
		tracesSampleRate: 0.05,
		sendDefaultPii: false,
		enableLogs: false,
		initialScope: { tags: { runtime: "web-server" } },
	};
}, entry);
