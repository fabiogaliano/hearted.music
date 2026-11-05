import * as Sentry from "@sentry/bun";
import { applyServerErrorFingerprint } from "@/lib/observability/sentry-before-send";
import { SENTRY_DATA_COLLECTION } from "@/lib/observability/sentry-data-collection";
import { registerWorkerFatalHandlers } from "./fatal-handlers";
import { initPostHogOtel } from "./posthog-otel";

const dsn = process.env.SENTRY_DSN;

// A blank value counts as unset so `SENTRY_ENVIRONMENT=` still falls through to
// NODE_ENV — `??` alone would resolve it to "" and skip the fallback entirely.
// Mirrors validateSentryEnv in server.ts.
function readEnvironment(): string | undefined {
	for (const value of [process.env.SENTRY_ENVIRONMENT, process.env.NODE_ENV]) {
		const trimmed = value?.trim();
		if (trimmed) return trimmed;
	}
	return undefined;
}

const environment = readEnvironment();

// A DSN left set locally would report `bun run dev:worker` errors to the
// production project. This denies known-local environments rather than
// allow-listing "production" deliberately: an unrecognised or unset
// environment still reports, so a missing var in the container can never
// silently blind us to production worker errors.
const LOCAL_ENVIRONMENTS = new Set(["development", "test", "local"]);
const isLocalEnvironment =
	environment !== undefined && LOCAL_ENVIRONMENTS.has(environment);

if (dsn && !isLocalEnvironment) {
	Sentry.init({
		dsn,
		environment,
		// Coolify injects SOURCE_COMMIT at runtime; APP_RELEASE is a manual override.
		release: process.env.SOURCE_COMMIT ?? process.env.APP_RELEASE,
		tracesSampleRate: 0.01,
		dataCollection: SENTRY_DATA_COLLECTION,
		// A synthetic call-site stack on captureMessage events would regroup
		// every existing message issue and count those sessions as errored.
		attachStacktrace: false,
		beforeSend: applyServerErrorFingerprint,
		// `enableOpenTelemetrySetup` stays off: if Sentry claims the global OTel
		// tracer provider first, initPostHogOtel's NodeSDK registration is
		// silently rejected and no LLM span reaches PostHog.
		// Not `runtime`: Sentry ingestion overwrites that tag from the event's
		// runtime context ("bun 1.x"), so alert filters on it never match.
		// Tags reach errors only; the attribute carries it onto spans.
		initialScope: {
			tags: { service: "worker" },
			attributes: { service: "worker" },
		},
	});
}

// This preload runs before src/worker/index.ts. Register fatal handlers here
// so bootstrap errors from PostHog init or later worker module loads are
// captured before control reaches the main entrypoint.
registerWorkerFatalHandlers();
initPostHogOtel();
