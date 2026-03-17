import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../config", () => ({
	workerConfig: {
		healthPort: 0,
	},
}));

type FetchHandler = (req: Request) => Response;

let capturedFetch: FetchHandler;

const mockServer = { port: 3001, stop: vi.fn() };

vi.stubGlobal("Bun", {
	serve: vi.fn((opts: { fetch: FetchHandler }) => {
		capturedFetch = opts.fetch;
		return mockServer;
	}),
});

describe("health server", () => {
	let startHealthServer: typeof import("../health").startHealthServer;
	let setShuttingDown: typeof import("../health").setShuttingDown;
	let setUnhealthy: typeof import("../health").setUnhealthy;

	beforeEach(async () => {
		vi.resetModules();
		const mod = await import("../health");
		startHealthServer = mod.startHealthServer;
		setShuttingDown = mod.setShuttingDown;
		setUnhealthy = mod.setUnhealthy;
	});

	it("returns 200 when healthy", async () => {
		startHealthServer();
		const response = capturedFetch(new Request("http://localhost/health"));
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.status).toBe("ok");
	});

	it("returns 503 when shutting down", async () => {
		startHealthServer();
		setShuttingDown();
		const response = capturedFetch(new Request("http://localhost/health"));
		expect(response.status).toBe(503);
		const body = await response.json();
		expect(body.shuttingDown).toBe(true);
	});

	it("returns 503 when unhealthy", async () => {
		startHealthServer();
		setUnhealthy();
		const response = capturedFetch(new Request("http://localhost/health"));
		expect(response.status).toBe(503);
	});

	it("returns 404 for non-health paths", async () => {
		startHealthServer();
		const response = capturedFetch(new Request("http://localhost/other"));
		expect(response.status).toBe(404);
	});
});
