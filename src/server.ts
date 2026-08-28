import * as Sentry from "@sentry/cloudflare";
import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { applyServerErrorFingerprint } from "@/lib/observability/sentry-before-send";

interface WorkerEnv {
	SENTRY_DSN?: string;
	SENTRY_ENVIRONMENT?: string;
	[key: string]: unknown;
}

// Mirrors the worker's denylist (src/worker/instrument.ts).
const LOCAL_ENVIRONMENTS = new Set(["development", "test", "local"]);

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
	// this project's Sentry volume. Two independent signals drop the DSN, and
	// either one suffices:
	//
	// - The build-time DEV flag. On its own it leaked again on 2026-08-01: Vite
	//   derives DEV from `process.env.NODE_ENV !== "production"`, so a shell that
	//   had NODE_ENV exported ran `vite dev` with DEV=false and HMR-session
	//   errors landed in the production project tagged `development`.
	// - A local SENTRY_ENVIRONMENT, which is what a dev .env actually sets. The
	//   string still defaults to "production" when unset, so a missing var in
	//   the deployed Worker can never silently blind us to production errors.
	//
	// Validation above still runs, so a malformed DSN fails loudly in dev.
	if (import.meta.env.DEV || LOCAL_ENVIRONMENTS.has(environment)) {
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
