import { describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
	prodRef: () => {
		throw new Error("Production credentials are unavailable");
	},
	warm: vi.fn(),
}));

import {
	getAllowedOrigins,
	handleRequest,
	isAllowedOrigin,
} from "../index";

describe("Control Panel API Hardening", () => {
	it("restricts allowed origins to configured Vite ports", () => {
		const origins = getAllowedOrigins();
		expect(origins.has("http://localhost:4318")).toBe(true);
		expect(origins.has("http://127.0.0.1:4318")).toBe(true);

		// Other localhost ports should not be in allowed set unless configured
		expect(isAllowedOrigin("http://localhost:4318")).toBe(true);
		expect(isAllowedOrigin("http://127.0.0.1:4318")).toBe(true);
		expect(isAllowedOrigin("http://localhost:9999")).toBe(false);
		expect(isAllowedOrigin("http://malicious.website.com")).toBe(false);
	});

	it("returns health without database credentials or sensitive tokens", async () => {
		const req = new Request("http://127.0.0.1:4319/api/health", {
			method: "GET",
		});
		const res = await handleRequest(req);
		expect(res.status).toBe(200);

		const data = (await res.json()) as Record<string, unknown>;
		expect(data.ok).toBe(true);
		expect(data.ref).toBe("(unavailable)");
		expect(typeof data.historyReady).toBe("boolean");

		// Crucial security invariant: no tokens, secrets, or keys in health output
		const serialized = JSON.stringify(data);
		expect(serialized).not.toContain("token");
		expect(serialized).not.toContain("key");
		expect(serialized).not.toContain("secret");
		expect(serialized).not.toContain("password");
	});

	it("rejects POST mutations with forbidden origins with 403 Forbidden", async () => {
		const req = new Request("http://127.0.0.1:4319/api/grants/preview", {
			method: "POST",
			headers: {
				Origin: "http://malicious.attacker.com",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ accountId: "123" }),
		});

		const res = await handleRequest(req);
		expect(res.status).toBe(403);
		const body = (await res.json()) as { error: string };
		expect(body.error).toBe("Forbidden origin");
	});

	it("returns 400 Bad Request on invalid telemetry preset", async () => {
		const req = new Request(
			"http://127.0.0.1:4319/api/telemetry/summary?range=unsupported_preset",
			{ method: "GET" },
		);

		const res = await handleRequest(req);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toContain("Invalid telemetry preset");
	});

	it("handles OPTIONS preflight with 204 No Content and CORS headers", async () => {
		const req = new Request("http://127.0.0.1:4319/api/telemetry/summary", {
			method: "OPTIONS",
			headers: {
				Origin: "http://localhost:4318",
			},
		});

		const res = await handleRequest(req);
		expect(res.status).toBe(204);
		expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
			"http://localhost:4318",
		);
		expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
	});
});
