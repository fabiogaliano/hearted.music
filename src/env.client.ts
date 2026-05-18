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
} as const;
