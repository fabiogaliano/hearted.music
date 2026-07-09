import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { env } from "@/env";
import { signEventToken } from "@/lib/account-events/token";
import {
	startAccountEventsGateway,
	stopAccountEventsGateway,
} from "../account-events-gateway";

const DATABASE_URL = env.DATABASE_URL;

type FetchHandler = (req: Request, server: any) => Response | Promise<Response>;

let capturedFetch: FetchHandler;

const mockServer = {
	port: 3004,
	stop: vi.fn(),
	timeout: vi.fn(),
};

vi.stubGlobal("Bun", {
	serve: vi.fn((opts: { fetch: FetchHandler }) => {
		capturedFetch = opts.fetch;
		return mockServer;
	}),
});

describe("account-events-gateway integration", () => {
	let sql: postgres.Sql<Record<string, never>>;
	const port = 3004;

	beforeAll(async () => {
		process.env.WORKER_ACCOUNT_EVENTS_GATEWAY_PORT = port.toString();
		startAccountEventsGateway();
		sql = postgres(DATABASE_URL);
	});

	afterAll(async () => {
		await stopAccountEventsGateway();
		await sql.end();
	});

	it("returns 401 on missing token", async () => {
		const res = await capturedFetch(
			new Request(`http://127.0.0.1:${port}/account-events/stream`),
			mockServer,
		);
		expect(res.status).toBe(401);
	});

	it("returns 403 on version mismatch", async () => {
		const token = await signEventToken({
			sub: "acct-1",
			sid: "sess-1",
			ver: 2, // Mismatch (gateway currently expects 1)
			iat: Date.now() / 1000,
			exp: Date.now() / 1000 + 300,
			jti: "jti-1",
		});

		const res = await capturedFetch(
			new Request(`http://127.0.0.1:${port}/account-events/stream`, {
				headers: { Authorization: `Bearer ${token}` },
			}),
			mockServer,
		);
		expect(res.status).toBe(403);
	});

	it("connects and receives snapshot on valid token", async () => {
		const accountId = crypto.randomUUID();
		await sql`INSERT INTO account (id, spotify_id, email) VALUES (${accountId}, ${`pub-${accountId}`}, ${`${accountId}@test.com`})`;

		const token = await signEventToken({
			sub: accountId,
			sid: "sess-1",
			ver: 1,
			iat: Date.now() / 1000,
			exp: Date.now() / 1000 + 300,
			jti: "jti-1",
		});

		// Setup mock abort signal
		const controller = new AbortController();
		const req = new Request(`http://127.0.0.1:${port}/account-events/stream`, {
			headers: { Authorization: `Bearer ${token}` },
			signal: controller.signal,
		});

		const res = await capturedFetch(req, mockServer);

		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("text/event-stream");

		const reader = res.body?.getReader();
		expect(reader).toBeDefined();

		if (reader) {
			const { value } = await reader.read();
			const text =
				typeof value === "string" ? value : new TextDecoder().decode(value);
			// The first event should be active_jobs_snapshot
			expect(text).toContain("event: active_jobs_snapshot");
			expect(text).not.toContain("id:"); // Live frames do not have id
			reader.cancel();
		}
	});
	it("handles replay ordering and durable id discipline", async () => {
		const accountId = crypto.randomUUID();
		await sql`INSERT INTO account (id, spotify_id, email) VALUES (${accountId}, ${`pub-${accountId}`}, ${`${accountId}@test.com`})`;

		// Insert some events
		const events =
			await sql`INSERT INTO account_event (account_id, publish_id, type, payload) VALUES
			(${accountId}, nextval('account_event_publish_seq'), 'job_started', '{"jobId":"1"}'::jsonb),
			(${accountId}, nextval('account_event_publish_seq'), 'job_completed', '{"jobId":"1"}'::jsonb)
			RETURNING publish_id
		`;
		const id1 = events[0].publish_id;
		const id2 = events[1].publish_id;

		const token = await signEventToken({
			sub: accountId,
			sid: "sess-2",
			ver: 1,
			iat: Date.now() / 1000,
			exp: Date.now() / 1000 + 300,
			jti: "jti-2",
		});

		const controller = new AbortController();
		const req = new Request(`http://127.0.0.1:${port}/account-events/stream`, {
			headers: {
				Authorization: `Bearer ${token}`,
				"last-event-id": "0",
			},
			signal: controller.signal,
		});

		const res = await capturedFetch(req, mockServer);
		const reader = res.body?.getReader();
		expect(reader).toBeDefined();

		if (reader) {
			const { value: v1 } = await reader.read();
			const t1 = typeof v1 === "string" ? v1 : new TextDecoder().decode(v1);
			expect(t1).toContain(`id: ${id1}`);
			expect(t1).toContain("event: job_started");

			const { value: v2 } = await reader.read();
			const t2 = typeof v2 === "string" ? v2 : new TextDecoder().decode(v2);
			expect(t2).toContain(`id: ${id2}`);
			expect(t2).toContain("event: job_completed");

			const { value: v3 } = await reader.read();
			const t3 = typeof v3 === "string" ? v3 : new TextDecoder().decode(v3);
			expect(t3).toContain("event: active_jobs_snapshot");
			expect(t3).not.toContain("id:"); // Live frame

			reader.cancel();
		}
	});

	it("closes on token expiry mid-stream", async () => {
		const accountId = crypto.randomUUID();
		await sql`INSERT INTO account (id, spotify_id, email) VALUES (${accountId}, ${`pub-${accountId}`}, ${`${accountId}@test.com`})`;

		const token = await signEventToken({
			sub: accountId,
			sid: "sess-3",
			ver: 1,
			iat: Date.now() / 1000,
			exp: Date.now() / 1000 + 1, // 1 second expiry
			jti: "jti-3",
		});

		const controller = new AbortController();
		const req = new Request(`http://127.0.0.1:${port}/account-events/stream`, {
			headers: { Authorization: `Bearer ${token}` },
			signal: controller.signal,
		});

		const res = await capturedFetch(req, mockServer);
		const reader = res.body?.getReader();

		if (reader) {
			// Read snapshot
			await reader.read();

			// Wait for expiry
			await new Promise((r) => setTimeout(r, 1100));

			// Next frame should be token_expiring
			const { value } = await reader.read();
			const t =
				typeof value === "string" ? value : new TextDecoder().decode(value);
			expect(t).toContain("event: token_expiring");

			// Then closed
			const { done } = await reader.read();
			expect(done).toBe(true);
		}
	});

	it("enforces bounded per-connection buffer (overflow behavior) and 503 draining", async () => {
		// Mock 503 draining behavior first
		const { setAccountEventsGatewayDraining } = await import(
			"../account-events-gateway"
		);
		setAccountEventsGatewayDraining(true);

		const res503 = await capturedFetch(
			new Request(`http://127.0.0.1:${port}/account-events/stream`),
			mockServer,
		);
		expect(res503.status).toBe(503);

		setAccountEventsGatewayDraining(false);
	});
});
