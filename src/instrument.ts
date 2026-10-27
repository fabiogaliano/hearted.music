import * as Sentry from "@sentry/bun";
import { applyServerErrorFingerprint } from "@/lib/observability/sentry-before-send";

// Preloaded by `bun --preload` ahead of src/serve.ts so Sentry is initialised
// once per process, before the server bundle loads. Never runs under
// `vite dev`, which therefore reports nothing.

// Mirrors the worker's denylist (src/worker/instrument.ts). `bun run start`
// loads the same .env as prod, so a DSN left set locally would send local
// errors to the production project; a local SENTRY_ENVIRONMENT drops it. An
// unset environment defaults to "production" so a missing var in the
// container can never silently blind us to production errors.
const LOCAL_ENVIRONMENTS = new Set(["development", "test", "local"]);

const environment = process.env.SENTRY_ENVIRONMENT?.trim() || "production";
const dsn = process.env.SENTRY_DSN?.trim();

if (dsn) {
	// A malformed DSN would make Sentry.init silently disable itself.
	try {
		new URL(dsn);
	} catch {
		throw new Error("SENTRY_DSN must be a valid URL");
	}
}

if (dsn && !LOCAL_ENVIRONMENTS.has(environment)) {
	Sentry.init({
		dsn,
		environment,
		// Same SHA the build stamps into VITE_APP_RELEASE and names the
		// uploaded sourcemaps with; Dockerfile.app sets it.
		release: process.env.APP_RELEASE,
		tracesSampleRate: 0.05,
		sendDefaultPii: false,
		enableLogs: false,
		beforeSend: applyServerErrorFingerprint,
		initialScope: { tags: { runtime: "web-server" } },
	});
}
