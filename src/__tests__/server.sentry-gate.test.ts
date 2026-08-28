import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockWithSentry } = vi.hoisted(() => ({ mockWithSentry: vi.fn() }));

vi.mock("@sentry/cloudflare", () => ({
	withSentry: mockWithSentry,
	captureException: vi.fn(),
}));
vi.mock("@tanstack/react-start/server-entry", () => ({
	default: { fetch: vi.fn() },
	createServerEntry: (entry: unknown) => entry,
}));
vi.mock("@/lib/observability/sentry-before-send", () => ({
	applyServerErrorFingerprint: vi.fn(),
}));

const DSN = "https://abc123@o1.ingest.sentry.io/2";

type OptionsCallback = (env: Record<string, unknown>) => { dsn?: string };

// The options callback is handed to withSentry at module-eval, so DEV must be
// stubbed before each import.
async function loadWith(dev: boolean): Promise<OptionsCallback> {
	vi.resetModules();
	vi.stubEnv("DEV", dev);
	await import("../server");
	const callback = mockWithSentry.mock.calls[0]?.[0] as OptionsCallback;
	return callback;
}

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("web-server Sentry gate", () => {
	it("reports in a production build with a production environment", async () => {
		const options = await loadWith(false);

		expect(
			options({ SENTRY_DSN: DSN, SENTRY_ENVIRONMENT: "production" }),
		).toMatchObject({ dsn: DSN, environment: "production" });
	});

	it("drops the DSN under vite dev regardless of environment", async () => {
		const options = await loadWith(true);

		expect(
			options({ SENTRY_DSN: DSN, SENTRY_ENVIRONMENT: "production" }).dsn,
		).toBeUndefined();
	});

	// Regression: 2026-08-01 dev-server errors reached the production project
	// because DEV alone was false (NODE_ENV=production in the shell) while the
	// local .env still named the environment "development".
	it.each([
		"development",
		"test",
		"local",
	])("drops the DSN for a %s environment even when DEV is false", async (environment) => {
		const options = await loadWith(false);

		expect(
			options({ SENTRY_DSN: DSN, SENTRY_ENVIRONMENT: environment }).dsn,
		).toBeUndefined();
	});

	// Fail-open on purpose: a Worker missing SENTRY_ENVIRONMENT must still report.
	it("reports when the environment is unset in a production build", async () => {
		const options = await loadWith(false);

		expect(options({ SENTRY_DSN: DSN })).toMatchObject({
			dsn: DSN,
			environment: "production",
		});
	});
});
