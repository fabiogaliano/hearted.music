import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockInit } = vi.hoisted(() => ({ mockInit: vi.fn() }));

vi.mock("@sentry/bun", () => ({
	init: mockInit,
	consoleLoggingIntegration: vi.fn(),
}));

const DSN = "https://abc123@o1.ingest.sentry.io/2";

// dsn/environment are read at module-eval, so env must be stubbed before import.
async function loadWith(env: Record<string, string | undefined>) {
	vi.resetModules();
	vi.unstubAllEnvs();
	// "" rather than leaving a key alone: the dev .env sets a real
	// SENTRY_ENVIRONMENT, which would otherwise leak into the "unset" case.
	for (const [key, value] of Object.entries(env)) {
		vi.stubEnv(key, value ?? "");
	}
	await import("../instrument");
}

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("web-server Sentry instrumentation", () => {
	it("reports when the environment is production", async () => {
		await loadWith({ SENTRY_DSN: DSN, SENTRY_ENVIRONMENT: "production" });

		expect(mockInit).toHaveBeenCalledTimes(1);
		expect(mockInit.mock.calls[0]?.[0]).toMatchObject({
			dsn: DSN,
			environment: "production",
		});
	});

	// Regression: the "server error volume" alert filters on this tag.
	it("tags events with service=web-server, since a runtime tag is overwritten by Sentry's runtime context", async () => {
		await loadWith({ SENTRY_DSN: DSN, SENTRY_ENVIRONMENT: "production" });

		const tags = mockInit.mock.calls[0]?.[0]?.initialScope?.tags;
		expect(tags).toEqual({ service: "web-server" });
	});

	// Regression: 2026-08-01 local errors reached the production project
	// because the local .env carried the production DSN.
	it.each([
		"development",
		"test",
		"local",
	])("stays silent in the %s environment even with a DSN set", async (environment) => {
		await loadWith({ SENTRY_DSN: DSN, SENTRY_ENVIRONMENT: environment });

		expect(mockInit).not.toHaveBeenCalled();
	});

	// Fail-open on purpose: a container missing SENTRY_ENVIRONMENT must still report.
	it("reports as production when the environment is unset", async () => {
		await loadWith({ SENTRY_DSN: DSN, SENTRY_ENVIRONMENT: undefined });

		expect(mockInit.mock.calls[0]?.[0]).toMatchObject({
			dsn: DSN,
			environment: "production",
		});
	});

	it("refuses to boot with a malformed DSN", async () => {
		await expect(
			loadWith({ SENTRY_DSN: "not a url", SENTRY_ENVIRONMENT: "production" }),
		).rejects.toThrow(/SENTRY_DSN/);
	});
});
