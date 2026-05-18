import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ALLOWED_DSN = "https://public@example.ingest.sentry.io/123456";

const fetchMock =
	vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

type TunnelRoute = {
	server: {
		handlers: {
			POST: (args: { request: Request }) => Promise<Response>;
		};
	};
};

function isTunnelRoute(value: unknown): value is TunnelRoute {
	if (typeof value !== "object" || value === null) {
		return false;
	}

	const server = Reflect.get(value, "server");
	if (typeof server !== "object" || server === null) {
		return false;
	}

	const handlers = Reflect.get(server, "handlers");
	if (typeof handlers !== "object" || handlers === null) {
		return false;
	}

	return typeof Reflect.get(handlers, "POST") === "function";
}

function createEnvelope(
	dsn: string = ALLOWED_DSN,
	payload: string = '{"type":"event"}',
): string {
	return `${JSON.stringify({ dsn })}\n${payload}`;
}

async function loadRoute(
	viteSentryDsn: string | undefined,
): Promise<TunnelRoute> {
	vi.resetModules();
	vi.doMock("@/env", () => ({
		env: {
			VITE_SENTRY_DSN: viteSentryDsn,
		},
	}));

	const module = await import("../sentry-tunnel");
	if (!isTunnelRoute(module.Route)) {
		throw new Error("Expected Route to expose a POST handler");
	}

	return module.Route;
}

vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (routeConfig: unknown) => routeConfig,
}));

describe("/api/sentry-tunnel", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		fetchMock.mockResolvedValue(
			new Response(JSON.stringify({ ok: true }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		);
		vi.spyOn(globalThis, "fetch").mockImplementation(fetchMock);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("forwards matching envelopes to the configured Sentry ingest URL", async () => {
		const route = await loadRoute(ALLOWED_DSN);
		const response = await route.server.handlers.POST({
			request: new Request("https://hearted.test/api/sentry-tunnel", {
				method: "POST",
				body: createEnvelope(),
			}),
		});

		expect(fetchMock).toHaveBeenCalledWith(
			"https://example.ingest.sentry.io/api/123456/envelope/",
			expect.objectContaining({
				method: "POST",
				headers: { "Content-Type": "application/x-sentry-envelope" },
			}),
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
	});

	it("rejects envelopes targeting a different Sentry project", async () => {
		const route = await loadRoute(ALLOWED_DSN);
		const response = await route.server.handlers.POST({
			request: new Request("https://hearted.test/api/sentry-tunnel", {
				method: "POST",
				body: createEnvelope("https://public@attacker.ingest.sentry.io/999999"),
			}),
		});

		expect(response.status).toBe(403);
		expect(await response.text()).toBe("DSN not allowed");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("rejects oversized envelopes", async () => {
		const route = await loadRoute(ALLOWED_DSN);
		const response = await route.server.handlers.POST({
			request: new Request("https://hearted.test/api/sentry-tunnel", {
				method: "POST",
				body: createEnvelope(ALLOWED_DSN, "a".repeat(200_001)),
			}),
		});

		expect(response.status).toBe(413);
		expect(await response.text()).toBe("Payload too large");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("returns 404 when the tunnel is disabled", async () => {
		const route = await loadRoute(undefined);
		const response = await route.server.handlers.POST({
			request: new Request("https://hearted.test/api/sentry-tunnel", {
				method: "POST",
				body: createEnvelope(),
			}),
		});

		expect(response.status).toBe(404);
		expect(await response.text()).toBe("Sentry tunnel disabled");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("returns 500 when the configured DSN is invalid", async () => {
		const route = await loadRoute("not-a-valid-dsn");
		const response = await route.server.handlers.POST({
			request: new Request("https://hearted.test/api/sentry-tunnel", {
				method: "POST",
				body: createEnvelope(),
			}),
		});

		expect(response.status).toBe(500);
		expect(await response.text()).toBe("Sentry tunnel misconfigured");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("rejects malformed envelopes before forwarding", async () => {
		const route = await loadRoute(ALLOWED_DSN);

		const malformedResponse = await route.server.handlers.POST({
			request: new Request("https://hearted.test/api/sentry-tunnel", {
				method: "POST",
				body: "not-an-envelope",
			}),
		});
		expect(malformedResponse.status).toBe(400);
		expect(await malformedResponse.text()).toBe("Malformed envelope");

		const invalidHeaderResponse = await route.server.handlers.POST({
			request: new Request("https://hearted.test/api/sentry-tunnel", {
				method: "POST",
				body: "{invalid-json}\npayload",
			}),
		});
		expect(invalidHeaderResponse.status).toBe(400);
		expect(await invalidHeaderResponse.text()).toBe("Invalid envelope header");

		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("rejects envelopes with missing or non-string DSNs", async () => {
		const route = await loadRoute(ALLOWED_DSN);

		const missingDsnResponse = await route.server.handlers.POST({
			request: new Request("https://hearted.test/api/sentry-tunnel", {
				method: "POST",
				body: `${JSON.stringify({})}\npayload`,
			}),
		});
		expect(missingDsnResponse.status).toBe(400);
		expect(await missingDsnResponse.text()).toBe("Missing DSN");

		const nonStringDsnResponse = await route.server.handlers.POST({
			request: new Request("https://hearted.test/api/sentry-tunnel", {
				method: "POST",
				body: `${JSON.stringify({ dsn: 123 })}\npayload`,
			}),
		});
		expect(nonStringDsnResponse.status).toBe(400);
		expect(await nonStringDsnResponse.text()).toBe("Missing DSN");

		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("rejects requests whose content-length exceeds the cap before reading the body", async () => {
		const route = await loadRoute(ALLOWED_DSN);
		const request = new Request("https://hearted.test/api/sentry-tunnel", {
			method: "POST",
			body: createEnvelope(),
			headers: { "content-length": "200001" },
		});
		const arrayBufferSpy = vi.spyOn(request, "arrayBuffer");

		const response = await route.server.handlers.POST({ request });

		expect(response.status).toBe(413);
		expect(await response.text()).toBe("Payload too large");
		expect(arrayBufferSpy).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
