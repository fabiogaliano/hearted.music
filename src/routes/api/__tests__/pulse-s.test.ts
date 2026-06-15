import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ALLOWED_DSN = "https://public@example.ingest.sentry.io/123456";
const MAX_ENVELOPE_BYTES = 15 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 15_000;

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

async function readBody(body: BodyInit | null | undefined): Promise<string> {
	if (body == null) {
		return "";
	}

	return new Response(body).text();
}

function createAbortError(): Error {
	const error = new Error("Aborted");
	error.name = "AbortError";
	return error;
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

	const module = await import("../pulse-s");
	if (!isTunnelRoute(module.Route)) {
		throw new Error("Expected Route to expose a POST handler");
	}

	return module.Route;
}

vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (routeConfig: unknown) => routeConfig,
}));

vi.mock("@/lib/platform/rate-limit/edge-rate-limit", () => ({
	clientIpFrom: (request: Request) =>
		request.headers.get("cf-connecting-ip") ?? "unknown",
	withinRateLimit: vi.fn().mockResolvedValue(true),
}));

vi.mock("@sentry/cloudflare", () => ({
	captureException: vi.fn(),
}));

describe("/api/pulse-s", () => {
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
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("streams matching envelopes to the configured Sentry ingest URL", async () => {
		const route = await loadRoute(ALLOWED_DSN);
		const request = new Request("https://hearted.test/api/pulse-s", {
			method: "POST",
			body: createEnvelope(),
		});
		const arrayBufferSpy = vi.spyOn(request, "arrayBuffer");

		const response = await route.server.handlers.POST({ request });

		expect(fetchMock).toHaveBeenCalledWith(
			"https://example.ingest.sentry.io/api/123456/envelope/",
			expect.objectContaining({
				method: "POST",
				headers: { "Content-Type": "application/x-sentry-envelope" },
				duplex: "half",
			}),
		);
		const [, upstreamInit] = fetchMock.mock.calls[0] ?? [];
		expect(await readBody(upstreamInit?.body)).toBe(createEnvelope());
		expect(arrayBufferSpy).not.toHaveBeenCalled();
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
	});

	it("rejects envelopes targeting a different Sentry project", async () => {
		const route = await loadRoute(ALLOWED_DSN);
		const response = await route.server.handlers.POST({
			request: new Request("https://hearted.test/api/pulse-s", {
				method: "POST",
				body: createEnvelope("https://public@attacker.ingest.sentry.io/999999"),
			}),
		});

		expect(response.status).toBe(403);
		expect(await response.text()).toBe("DSN not allowed");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("returns 404 when the tunnel is disabled", async () => {
		const route = await loadRoute(undefined);
		const response = await route.server.handlers.POST({
			request: new Request("https://hearted.test/api/pulse-s", {
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
			request: new Request("https://hearted.test/api/pulse-s", {
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
		const malformedRequest = new Request("https://hearted.test/api/pulse-s", {
			method: "POST",
			body: "not-an-envelope",
		});
		const malformedArrayBufferSpy = vi.spyOn(malformedRequest, "arrayBuffer");

		const malformedResponse = await route.server.handlers.POST({
			request: malformedRequest,
		});
		expect(malformedResponse.status).toBe(400);
		expect(await malformedResponse.text()).toBe("Malformed envelope");
		expect(malformedArrayBufferSpy).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("rejects envelopes with an invalid JSON header before forwarding", async () => {
		const route = await loadRoute(ALLOWED_DSN);
		const invalidHeaderRequest = new Request(
			"https://hearted.test/api/pulse-s",
			{
				method: "POST",
				body: "{invalid-json}\npayload",
			},
		);
		const invalidHeaderArrayBufferSpy = vi.spyOn(
			invalidHeaderRequest,
			"arrayBuffer",
		);

		const invalidHeaderResponse = await route.server.handlers.POST({
			request: invalidHeaderRequest,
		});
		expect(invalidHeaderResponse.status).toBe(400);
		expect(await invalidHeaderResponse.text()).toBe("Invalid envelope header");
		expect(invalidHeaderArrayBufferSpy).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("rejects envelopes with a missing DSN", async () => {
		const route = await loadRoute(ALLOWED_DSN);

		const missingDsnResponse = await route.server.handlers.POST({
			request: new Request("https://hearted.test/api/pulse-s", {
				method: "POST",
				body: `${JSON.stringify({})}\npayload`,
			}),
		});
		expect(missingDsnResponse.status).toBe(400);
		expect(await missingDsnResponse.text()).toBe("Missing DSN");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("rejects envelopes with a non-string DSN", async () => {
		const route = await loadRoute(ALLOWED_DSN);

		const nonStringDsnResponse = await route.server.handlers.POST({
			request: new Request("https://hearted.test/api/pulse-s", {
				method: "POST",
				body: `${JSON.stringify({ dsn: 123 })}\npayload`,
			}),
		});
		expect(nonStringDsnResponse.status).toBe(400);
		expect(await nonStringDsnResponse.text()).toBe("Missing DSN");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("rejects envelopes that exceed the streaming size cap", async () => {
		fetchMock.mockImplementationOnce(async (_input, init) => {
			await new Response(init?.body).arrayBuffer();
			return new Response(JSON.stringify({ ok: true }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		});
		const route = await loadRoute(ALLOWED_DSN);
		const response = await route.server.handlers.POST({
			request: new Request("https://hearted.test/api/pulse-s", {
				method: "POST",
				body: createEnvelope(ALLOWED_DSN, "a".repeat(MAX_ENVELOPE_BYTES)),
			}),
		});

		expect(response.status).toBe(413);
		expect(await response.text()).toBe("Payload too large");
	});

	it("times out when Sentry ingest does not respond in time", async () => {
		vi.useFakeTimers();
		fetchMock.mockImplementationOnce(
			(_input, init) =>
				new Promise<Response>((_resolve, reject) => {
					const signal = init?.signal;
					if (!(signal instanceof AbortSignal)) {
						reject(new Error("Missing abort signal"));
						return;
					}

					if (signal.aborted) {
						reject(createAbortError());
						return;
					}

					signal.addEventListener("abort", () => reject(createAbortError()), {
						once: true,
					});
				}),
		);
		const route = await loadRoute(ALLOWED_DSN);
		const responsePromise = route.server.handlers.POST({
			request: new Request("https://hearted.test/api/pulse-s", {
				method: "POST",
				body: createEnvelope(),
			}),
		});

		await vi.advanceTimersByTimeAsync(UPSTREAM_TIMEOUT_MS);
		const response = await responsePromise;

		expect(response.status).toBe(504);
		expect(await response.text()).toBe("Timed out sending envelope to Sentry");
	});

	it("returns 429 when rate limited", async () => {
		const { withinRateLimit } = await import(
			"@/lib/platform/rate-limit/edge-rate-limit"
		);
		vi.mocked(withinRateLimit).mockResolvedValueOnce(false);

		const route = await loadRoute(ALLOWED_DSN);
		const response = await route.server.handlers.POST({
			request: new Request("https://hearted.test/api/pulse-s", {
				method: "POST",
				body: createEnvelope(),
			}),
		});

		expect(response.status).toBe(429);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("returns 502 when forwarding to Sentry ingest throws", async () => {
		fetchMock.mockRejectedValueOnce(new Error("upstream down"));
		const route = await loadRoute(ALLOWED_DSN);
		const response = await route.server.handlers.POST({
			request: new Request("https://hearted.test/api/pulse-s", {
				method: "POST",
				body: createEnvelope(),
			}),
		});

		expect(response.status).toBe(502);
		expect(await response.text()).toBe("Failed to reach Sentry ingest");
	});
});
