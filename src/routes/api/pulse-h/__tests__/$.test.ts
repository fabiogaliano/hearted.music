import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const UPSTREAM_TIMEOUT_MS = 15_000;

const fetchMock =
	vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

type TunnelRoute = {
	server: {
		handlers: {
			GET: (args: { request: Request }) => Promise<Response>;
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

	return (
		typeof Reflect.get(handlers, "GET") === "function" &&
		typeof Reflect.get(handlers, "POST") === "function"
	);
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
	vitePublicPosthogHost: string | undefined,
): Promise<TunnelRoute> {
	vi.resetModules();
	vi.doMock("@/env", () => ({
		env: {
			VITE_PUBLIC_POSTHOG_HOST: vitePublicPosthogHost,
		},
	}));

	const module = await import("../$");
	if (!isTunnelRoute(module.Route)) {
		throw new Error("Expected Route to expose GET and POST handlers");
	}

	return module.Route;
}

vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (routeConfig: unknown) => routeConfig,
}));

describe("/api/pulse-h/$", () => {
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

	it("forwards event ingestion requests to PostHog EU ingest", async () => {
		const route = await loadRoute(undefined);
		const request = new Request("https://hearted.test/api/pulse-h/e/?ip=1", {
			method: "POST",
			body: JSON.stringify({ event: "pageview" }),
			headers: { "Content-Type": "application/json" },
		});

		const response = await route.server.handlers.POST({ request });

		expect(fetchMock).toHaveBeenCalledWith(
			"https://eu.i.posthog.com/e/?ip=1",
			expect.objectContaining({
				method: "POST",
				headers: expect.any(Headers),
				duplex: "half",
			}),
		);
		const [, upstreamInit] = fetchMock.mock.calls[0] ?? [];
		expect(await readBody(upstreamInit?.body)).toBe(
			JSON.stringify({ event: "pageview" }),
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
	});

	it("strips upstream access-control headers from responses", async () => {
		fetchMock.mockResolvedValueOnce(
			new Response(JSON.stringify({ ok: true }), {
				status: 200,
				headers: {
					"Content-Type": "application/json",
					"Access-Control-Allow-Origin": "*",
					"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
					"Access-Control-Allow-Headers": "Content-Type",
					"Cache-Control": "no-cache",
				},
			}),
		);
		const route = await loadRoute(undefined);
		const response = await route.server.handlers.POST({
			request: new Request("https://hearted.test/api/pulse-h/e/", {
				method: "POST",
				body: "{}",
			}),
		});

		expect(response.headers.get("content-type")).toBe("application/json");
		expect(response.headers.get("cache-control")).toBe("no-cache");
		expect(response.headers.has("access-control-allow-origin")).toBe(false);
		expect(response.headers.has("access-control-allow-methods")).toBe(false);
		expect(response.headers.has("access-control-allow-headers")).toBe(false);
	});

	it("forwards asset requests to PostHog's asset host", async () => {
		const route = await loadRoute("https://eu.i.posthog.com");
		const response = await route.server.handlers.GET({
			request: new Request(
				"https://hearted.test/api/pulse-h/array/phc_token/config.js?_=123",
				{ method: "GET" },
			),
		});

		expect(fetchMock).toHaveBeenCalledWith(
			"https://eu-assets.i.posthog.com/array/phc_token/config.js?_=123",
			expect.objectContaining({ method: "GET" }),
		);
		expect(response.status).toBe(200);
	});

	it("falls back to the default EU host in non-prod when the configured host is invalid", async () => {
		const route = await loadRoute("https://us.i.posthog.com");
		const response = await route.server.handlers.POST({
			request: new Request("https://hearted.test/api/pulse-h/e/", {
				method: "POST",
				body: "{}",
			}),
		});

		expect(fetchMock).toHaveBeenCalledWith(
			"https://eu.i.posthog.com/e/",
			expect.objectContaining({ method: "POST", duplex: "half" }),
		);
		expect(response.status).toBe(200);
	});

	it("times out when PostHog does not respond in time", async () => {
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
		const route = await loadRoute(undefined);
		const responsePromise = route.server.handlers.POST({
			request: new Request("https://hearted.test/api/pulse-h/e/", {
				method: "POST",
				body: "{}",
			}),
		});

		await vi.advanceTimersByTimeAsync(UPSTREAM_TIMEOUT_MS);
		const response = await responsePromise;

		expect(response.status).toBe(504);
		expect(await response.text()).toBe("Timed out sending request to PostHog");
	});
});
