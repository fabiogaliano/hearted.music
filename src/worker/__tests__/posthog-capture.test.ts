import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockCapture, mockShutdown, PostHogCtor } = vi.hoisted(() => {
	const mockCapture = vi.fn();
	const mockShutdown = vi.fn(() => Promise.resolve());
	const PostHogCtor = vi.fn(function PostHog() {
		return { capture: mockCapture, shutdown: mockShutdown };
	});
	return { mockCapture, mockShutdown, PostHogCtor };
});

vi.mock("posthog-node", () => ({ PostHog: PostHogCtor }));

// apiKey/host are read at module-eval, so env must be stubbed before importing.
async function loadWith(env: Record<string, string | undefined>) {
	vi.resetModules();
	vi.unstubAllEnvs();
	// Stub even the "unset" keys to "" so a real value in the dev .env can't leak
	// in; "" short-circuits the `?? VITE_…` fallback and trips the `!apiKey` guard.
	for (const [key, value] of Object.entries(env)) {
		vi.stubEnv(key, value ?? "");
	}
	return import("../posthog-capture");
}

const PROD_ENV = {
	NODE_ENV: "production",
	POSTHOG_PROJECT_TOKEN: "phc_test",
	POSTHOG_HOST: "https://eu.i.posthog.com",
};

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("captureWorkerEvent", () => {
	it("forwards the event to a single lazily-constructed client in production", async () => {
		const { captureWorkerEvent } = await loadWith(PROD_ENV);

		captureWorkerEvent({
			distinctId: "acc-1",
			event: "match_snapshot_published",
			properties: { published: true },
		});
		captureWorkerEvent({ distinctId: "acc-1", event: "second" });

		expect(PostHogCtor).toHaveBeenCalledTimes(1);
		expect(mockCapture).toHaveBeenCalledTimes(2);
		expect(mockCapture).toHaveBeenNthCalledWith(1, {
			distinctId: "acc-1",
			event: "match_snapshot_published",
			properties: { published: true },
		});
	});

	it("is a no-op outside production", async () => {
		const { captureWorkerEvent } = await loadWith({
			...PROD_ENV,
			NODE_ENV: "test",
		});

		captureWorkerEvent({
			distinctId: "acc-1",
			event: "match_snapshot_published",
		});

		expect(PostHogCtor).not.toHaveBeenCalled();
		expect(mockCapture).not.toHaveBeenCalled();
	});

	it("is a no-op when the project token is unset", async () => {
		const { captureWorkerEvent } = await loadWith({
			NODE_ENV: "production",
			POSTHOG_PROJECT_TOKEN: undefined,
			VITE_PUBLIC_POSTHOG_PROJECT_TOKEN: undefined,
			POSTHOG_HOST: "https://eu.i.posthog.com",
		});

		captureWorkerEvent({
			distinctId: "acc-1",
			event: "match_snapshot_published",
		});

		expect(PostHogCtor).not.toHaveBeenCalled();
	});

	it("flushes the client on shutdown", async () => {
		const { captureWorkerEvent, shutdownWorkerPostHog } =
			await loadWith(PROD_ENV);

		captureWorkerEvent({
			distinctId: "acc-1",
			event: "match_snapshot_published",
		});
		await shutdownWorkerPostHog();

		expect(mockShutdown).toHaveBeenCalledTimes(1);
	});

	it("resolves shutdown to a no-op when no client was created", async () => {
		const { shutdownWorkerPostHog } = await loadWith({ NODE_ENV: "test" });

		await expect(shutdownWorkerPostHog()).resolves.toBeUndefined();
		expect(mockShutdown).not.toHaveBeenCalled();
	});
});
