function readOptionalClientEnv(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

export const clientEnv = {
	VITE_APP_TITLE: readOptionalClientEnv(import.meta.env.VITE_APP_TITLE),
	VITE_CHROME_EXTENSION_ID: readOptionalClientEnv(
		import.meta.env.VITE_CHROME_EXTENSION_ID,
	),
	VITE_SENTRY_DSN: readOptionalClientEnv(import.meta.env.VITE_SENTRY_DSN),
	VITE_SENTRY_ENVIRONMENT: readOptionalClientEnv(
		import.meta.env.VITE_SENTRY_ENVIRONMENT,
	),
	// Only used to build deep links from PostHog exception events into Sentry
	// issues. The Sentry⇄PostHog integration becomes a no-op without it.
	VITE_SENTRY_ORG_SLUG: readOptionalClientEnv(
		import.meta.env.VITE_SENTRY_ORG_SLUG,
	),
} as const;
