import * as Sentry from "@sentry/cloudflare";
import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { applyServerErrorFingerprint } from "@/lib/observability/sentry-before-send";

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

	// `bun run dev` loads the same .env as prod, so a DSN left set locally sends
	// every dev-server error to the production project — that leak was ~98% of
	// this project's Sentry volume. Gate on the build-time DEV flag rather than
	// SENTRY_ENVIRONMENT: the environment string defaults to "production" when
	// unset, so trusting it would let one missing var reopen the leak. Validation
	// above still runs, so a malformed DSN fails loudly in dev where it's seen.
	if (import.meta.env.DEV) {
		return { environment };
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
		beforeSend: applyServerErrorFingerprint,
		initialScope: { tags: { runtime: "web-server" } },
	};
}, entry);
