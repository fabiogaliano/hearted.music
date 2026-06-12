import * as Sentry from "@sentry/react";
import type { PostHogInterface } from "posthog-js";
import { clientEnv } from "@/env.public";

type SentryIntegration = Parameters<typeof Sentry.addIntegration>[0];

// Extracts the numeric project ID from a Sentry DSN. The DSN's last path
// segment is the project ID; everything else is optional ingest tunneling
// metadata that varies by org.
function extractSentryProjectId(dsn: string): string | null {
	try {
		const url = new URL(dsn);
		const projectId = url.pathname.replace(/\/+$/, "").split("/").at(-1);
		return projectId && projectId.length > 0 ? projectId : null;
	} catch {
		return null;
	}
}

/**
 * Registers the PostHog ⇄ Sentry cross-link integration with an already
 * initialized Sentry client. Called once from PostHogProvider's `loaded`
 * callback so both SDKs are guaranteed live before the link is established.
 *
 * Effect: every Sentry event gets tagged with `posthog_session_url` +
 * `posthog_distinct_id`, and PostHog $exception events get a Sentry issue URL
 * attached when the org slug is configured.
 *
 * Safely no-ops when Sentry isn't configured (no DSN), the integration isn't
 * available on the PostHog instance, or required env is missing.
 */
export function linkPostHogToSentry(posthog: PostHogInterface): void {
	const dsn = clientEnv.VITE_SENTRY_DSN;
	const orgSlug = clientEnv.VITE_SENTRY_ORG_SLUG;
	if (!dsn) return;

	const projectId = extractSentryProjectId(dsn);
	if (!projectId) return;

	// Use the functional `sentryIntegration`, not the legacy `SentryIntegration`
	// class. The class implements the Sentry v7 `setupOnce(addGlobalEventProcessor)`
	// API; on Sentry v8+ `setupOnce` is called with no arguments, so it throws
	// "o is not a function". The functional form returns a `processEvent`-based
	// integration that's compatible with our @sentry/react v10.
	const sentryIntegration = (
		posthog as PostHogInterface & {
			sentryIntegration?: (
				posthog: PostHogInterface,
				options?: {
					organization?: string;
					projectId?: number;
					prefix?: string;
					severityAllowList?: Array<string> | "*";
					sendExceptionsToPostHog?: boolean;
				},
			) => SentryIntegration;
		}
	).sentryIntegration;

	if (!sentryIntegration) return;

	Sentry.addIntegration(
		sentryIntegration(posthog, {
			organization: orgSlug,
			// The functional integration types projectId as numeric; the DSN path
			// segment is always digits, so a safe parse keeps the direct-link URLs
			// correct.
			projectId: Number(projectId),
		}),
	);
}
