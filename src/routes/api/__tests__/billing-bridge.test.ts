import { beforeEach, describe, expect, it, vi } from "vitest";
import { signBridgeRequest } from "@/lib/domains/billing/hmac";
import { Route } from "../billing-bridge";

const SECRET = "bridge-test-secret";
const ACCOUNT_ID = "6f1c2a0e-7a4b-4c0f-9d51-2b7f3e8a9c10";

const { rpc, handlePackFulfilled } = vi.hoisted(() => ({
	rpc: vi.fn(),
	handlePackFulfilled: vi.fn(),
}));

vi.mock("@/env", () => ({
	env: { BILLING_ENABLED: true, BILLING_SHARED_SECRET: "bridge-test-secret" },
}));

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: () => ({ rpc }),
}));

vi.mock("@/lib/domains/billing/bridge-handlers", () => ({
	handlePackFulfilled,
	handlePackReversed: vi.fn(),
	handleSubscriptionDeactivated: vi.fn(),
	handleUnlimitedActivated: vi.fn(),
	handleUnlimitedPeriodReversed: vi.fn(),
}));

vi.mock("@/lib/platform/rate-limit/edge-rate-limit", () => ({
	clientIpFrom: () => "203.0.113.7",
	withinRateLimit: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/observability/capture-server-error", () => ({
	captureServerError: vi.fn(),
}));

vi.mock("@/utils/posthog-server", () => ({
	captureWithWaitUntil: vi.fn().mockResolvedValue(undefined),
}));

type ClaimOutcome = "claimed" | "duplicate_processed" | "in_progress";

type BridgeRoute = {
	server: {
		handlers: { POST: (args: { request: Request }) => Promise<Response> };
	};
};

function post(request: Request): Promise<Response> {
	return (Route.options as unknown as BridgeRoute).server.handlers.POST({
		request,
	});
}

function packFulfilledBody(stripeEventId: string): string {
	return JSON.stringify({
		stripe_event_id: stripeEventId,
		event_kind: "pack_fulfilled",
		schema_version: 2,
		account_id: ACCOUNT_ID,
		bonus_unlocked_song_ids: [],
	});
}

async function signedRequest(
	body: string,
	secret: string = SECRET,
): Promise<Request> {
	const { timestamp, signature } = await signBridgeRequest(body, secret);
	return new Request("https://hearted.test/api/billing-bridge", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"X-Timestamp": timestamp,
			"X-Signature": signature,
		},
		body,
	});
}

function claimReturns(outcome: ClaimOutcome) {
	rpc.mockImplementation(async (fn: string) => {
		if (fn === "claim_billing_bridge_event") {
			return { data: outcome, error: null };
		}
		return { data: null, error: null };
	});
}

function rpcCallsTo(fn: string): Record<string, unknown>[] {
	return rpc.mock.calls
		.filter(([name]) => name === fn)
		.map(([, args]) => args as Record<string, unknown>);
}

describe("POST /api/billing-bridge", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});
	});

	it("rejects a body signed with the wrong secret before claiming or dispatching", async () => {
		claimReturns("claimed");

		const response = await post(
			await signedRequest(packFulfilledBody("evt_forged"), "attacker-secret"),
		);

		expect(response.status).toBe(401);
		expect(rpc).not.toHaveBeenCalled();
		expect(handlePackFulfilled).not.toHaveBeenCalled();
	});

	it("runs the handler and finalizes processed with the same claim token", async () => {
		claimReturns("claimed");

		const response = await post(
			await signedRequest(packFulfilledBody("evt_ok")),
		);

		expect(response.status).toBe(200);
		expect(handlePackFulfilled).toHaveBeenCalledTimes(1);
		const [claimArgs] = rpcCallsTo("claim_billing_bridge_event");
		const [processedArgs] = rpcCallsTo("mark_billing_bridge_event_processed");
		expect(claimArgs?.p_claim_token).toEqual(expect.any(String));
		expect(processedArgs).toEqual({
			p_stripe_event_id: "evt_ok",
			p_claim_token: claimArgs?.p_claim_token,
		});
		expect(rpcCallsTo("mark_billing_bridge_event_failed")).toEqual([]);
	});

	it("acknowledges an already-processed event without re-running the handler", async () => {
		claimReturns("duplicate_processed");

		const response = await post(
			await signedRequest(packFulfilledBody("evt_dup")),
		);

		expect(response.status).toBe(200);
		expect(handlePackFulfilled).not.toHaveBeenCalled();
		expect(rpcCallsTo("mark_billing_bridge_event_processed")).toEqual([]);
	});

	it("answers 409 while another worker holds the lease, without dispatching", async () => {
		claimReturns("in_progress");

		const response = await post(
			await signedRequest(packFulfilledBody("evt_busy")),
		);

		expect(response.status).toBe(409);
		expect(handlePackFulfilled).not.toHaveBeenCalled();
	});

	it("marks the claim failed and answers 5xx when the handler throws, so the upstream retry reclaims it", async () => {
		claimReturns("claimed");
		handlePackFulfilled.mockRejectedValueOnce(new Error("grant exploded"));

		const response = await post(
			await signedRequest(packFulfilledBody("evt_fail")),
		);

		expect(response.status).toBe(500);
		const [claimArgs] = rpcCallsTo("claim_billing_bridge_event");
		expect(rpcCallsTo("mark_billing_bridge_event_failed")).toEqual([
			{
				p_stripe_event_id: "evt_fail",
				p_error_message: expect.stringMatching(/grant exploded/),
				p_claim_token: claimArgs?.p_claim_token,
			},
		]);
		expect(rpcCallsTo("mark_billing_bridge_event_processed")).toEqual([]);
	});

	it("answers 5xx when the claim RPC errors so the upstream retries instead of dropping the event", async () => {
		rpc.mockResolvedValue({ data: null, error: { message: "db down" } });

		const response = await post(
			await signedRequest(packFulfilledBody("evt_claim_err")),
		);

		expect(response.status).toBe(500);
		expect(handlePackFulfilled).not.toHaveBeenCalled();
	});
});
