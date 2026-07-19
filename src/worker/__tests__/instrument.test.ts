import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockInit, mockRegisterFatalHandlers, mockInitPostHogOtel } = vi.hoisted(
	() => ({
		mockInit: vi.fn(),
		mockRegisterFatalHandlers: vi.fn(),
		mockInitPostHogOtel: vi.fn(),
	}),
);

vi.mock("@sentry/bun", () => ({ init: mockInit }));
vi.mock("../fatal-handlers", () => ({
	registerWorkerFatalHandlers: mockRegisterFatalHandlers,
}));
vi.mock("../posthog-otel", () => ({ initPostHogOtel: mockInitPostHogOtel }));

const DSN = "https://abc123@o1.ingest.sentry.io/2";

// dsn/environment are read at module-eval, so env must be stubbed before import.
async function loadWith(env: Record<string, string | undefined>) {
	vi.resetModules();
	vi.unstubAllEnvs();
	// Stub unset keys to "" rather than leaving them: the dev .env sets a real
	// SENTRY_ENVIRONMENT, which would otherwise leak into the "unset" cases.
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

describe("worker Sentry instrumentation", () => {
	it("reports when the environment is production", async () => {
		await loadWith({ SENTRY_DSN: DSN, SENTRY_ENVIRONMENT: "production" });

		expect(mockInit).toHaveBeenCalledTimes(1);
		expect(mockInit.mock.calls[0]?.[0]).toMatchObject({
			dsn: DSN,
			environment: "production",
		});
	});

	it.each([
		"development",
		"test",
		"local",
	])("stays silent in the %s environment even with a DSN set", async (environment) => {
		await loadWith({ SENTRY_DSN: DSN, SENTRY_ENVIRONMENT: environment });

		expect(mockInit).not.toHaveBeenCalled();
	});

	it("falls back to NODE_ENV when SENTRY_ENVIRONMENT is unset", async () => {
		await loadWith({
			SENTRY_DSN: DSN,
			SENTRY_ENVIRONMENT: undefined,
			NODE_ENV: "development",
		});

		expect(mockInit).not.toHaveBeenCalled();
	});

	// Fail-open is deliberate: a container missing both vars must still report,
	// so one absent env var can never silently blind us to production errors.
	it("reports when the environment cannot be determined", async () => {
		await loadWith({
			SENTRY_DSN: DSN,
			SENTRY_ENVIRONMENT: undefined,
			NODE_ENV: undefined,
		});

		expect(mockInit).toHaveBeenCalledTimes(1);
	});

	it("reports for an unrecognised environment such as staging", async () => {
		await loadWith({ SENTRY_DSN: DSN, SENTRY_ENVIRONMENT: "staging" });

		expect(mockInit).toHaveBeenCalledTimes(1);
	});

	it("stays silent without a DSN", async () => {
		await loadWith({ SENTRY_DSN: undefined, SENTRY_ENVIRONMENT: "production" });

		expect(mockInit).not.toHaveBeenCalled();
	});

	// Fatal handlers must register even when Sentry is off, or a dev-mode crash
	// goes unlogged entirely.
	it("registers fatal handlers regardless of Sentry being disabled", async () => {
		await loadWith({ SENTRY_DSN: DSN, SENTRY_ENVIRONMENT: "development" });

		expect(mockRegisterFatalHandlers).toHaveBeenCalledTimes(1);
		expect(mockInitPostHogOtel).toHaveBeenCalledTimes(1);
	});
});
