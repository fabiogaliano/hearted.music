import { describe, expect, it } from "vitest";
import { signBridgeRequest, verifyBridgeHmac } from "../hmac";

const TEST_SECRET = "test-shared-secret-key";

function makeRequest(body: string, headers: Record<string, string>): Request {
	return new Request("http://localhost/api/billing-bridge", {
		method: "POST",
		headers: { "Content-Type": "application/json", ...headers },
		body,
	});
}

describe("verifyBridgeHmac", () => {
	it("accepts a valid signed request", async () => {
		const body = JSON.stringify({ test: "data" });
		const { timestamp, signature } = await signBridgeRequest(body, TEST_SECRET);
		const request = makeRequest(body, {
			"X-Timestamp": timestamp,
			"X-Signature": signature,
		});

		const result = await verifyBridgeHmac(request, TEST_SECRET);

		expect(result).toEqual({ valid: true, body });
	});

	it("rejects when X-Timestamp header is missing", async () => {
		const body = JSON.stringify({ test: "data" });
		const { signature } = await signBridgeRequest(body, TEST_SECRET);
		const request = makeRequest(body, { "X-Signature": signature });

		const result = await verifyBridgeHmac(request, TEST_SECRET);

		expect(result).toEqual({
			valid: false,
			error: "Missing authentication headers",
		});
	});

	it("rejects when X-Signature header is missing", async () => {
		const body = JSON.stringify({ test: "data" });
		const { timestamp } = await signBridgeRequest(body, TEST_SECRET);
		const request = makeRequest(body, { "X-Timestamp": timestamp });

		const result = await verifyBridgeHmac(request, TEST_SECRET);

		expect(result).toEqual({
			valid: false,
			error: "Missing authentication headers",
		});
	});

	it("rejects an invalid signature", async () => {
		const body = JSON.stringify({ test: "data" });
		const { timestamp } = await signBridgeRequest(body, TEST_SECRET);
		const request = makeRequest(body, {
			"X-Timestamp": timestamp,
			"X-Signature": "deadbeef".repeat(8),
		});

		const result = await verifyBridgeHmac(request, TEST_SECRET);

		expect(result).toEqual({ valid: false, error: "Invalid signature" });
	});

	it("rejects a signature made with wrong secret", async () => {
		const body = JSON.stringify({ test: "data" });
		const { timestamp, signature } = await signBridgeRequest(
			body,
			"wrong-secret",
		);
		const request = makeRequest(body, {
			"X-Timestamp": timestamp,
			"X-Signature": signature,
		});

		const result = await verifyBridgeHmac(request, TEST_SECRET);

		expect(result).toEqual({ valid: false, error: "Invalid signature" });
	});

	it("rejects an expired timestamp (> 5 min old)", async () => {
		const body = JSON.stringify({ test: "data" });
		const staleTime = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago
		const { timestamp, signature } = await signBridgeRequest(
			body,
			TEST_SECRET,
			staleTime,
		);
		const request = makeRequest(body, {
			"X-Timestamp": timestamp,
			"X-Signature": signature,
		});

		const result = await verifyBridgeHmac(request, TEST_SECRET);

		expect(result).toEqual({
			valid: false,
			error: "Request timestamp expired",
		});
	});

	it("rejects a future timestamp (> 5 min ahead)", async () => {
		const body = JSON.stringify({ test: "data" });
		const futureTime = Math.floor(Date.now() / 1000) + 600; // 10 minutes ahead
		const { timestamp, signature } = await signBridgeRequest(
			body,
			TEST_SECRET,
			futureTime,
		);
		const request = makeRequest(body, {
			"X-Timestamp": timestamp,
			"X-Signature": signature,
		});

		const result = await verifyBridgeHmac(request, TEST_SECRET);

		expect(result).toEqual({
			valid: false,
			error: "Request timestamp expired",
		});
	});

	it("rejects a non-numeric timestamp", async () => {
		const body = JSON.stringify({ test: "data" });
		const request = makeRequest(body, {
			"X-Timestamp": "not-a-number",
			"X-Signature": "deadbeef",
		});

		const result = await verifyBridgeHmac(request, TEST_SECRET);

		expect(result).toEqual({ valid: false, error: "Invalid timestamp" });
	});

	it("accepts a request within the clock skew window", async () => {
		const body = JSON.stringify({ test: "data" });
		const slightlyOld = Math.floor(Date.now() / 1000) - 250; // 4 min 10 sec ago (within 5 min)
		const { timestamp, signature } = await signBridgeRequest(
			body,
			TEST_SECRET,
			slightlyOld,
		);
		const request = makeRequest(body, {
			"X-Timestamp": timestamp,
			"X-Signature": signature,
		});

		const result = await verifyBridgeHmac(request, TEST_SECRET);

		expect(result).toEqual({ valid: true, body });
	});
});

describe("signBridgeRequest", () => {
	it("produces deterministic signatures for same inputs", async () => {
		const body = '{"hello":"world"}';
		const ts = 1700000000;

		const a = await signBridgeRequest(body, TEST_SECRET, ts);
		const b = await signBridgeRequest(body, TEST_SECRET, ts);

		expect(a.signature).toBe(b.signature);
		expect(a.timestamp).toBe(b.timestamp);
	});

	it("produces different signatures for different bodies", async () => {
		const ts = 1700000000;

		const a = await signBridgeRequest('{"a":1}', TEST_SECRET, ts);
		const b = await signBridgeRequest('{"b":2}', TEST_SECRET, ts);

		expect(a.signature).not.toBe(b.signature);
	});
});
