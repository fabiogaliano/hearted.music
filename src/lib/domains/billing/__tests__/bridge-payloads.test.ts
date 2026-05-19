import { Result } from "better-result";
import { describe, expect, it } from "vitest";
import { parseBridgePayload } from "@/lib/domains/billing/bridge-payloads";

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";

function expectOk<T>(result: Result<T, unknown>): T {
	if (!Result.isOk(result)) {
		throw new Error("Expected successful bridge payload parse");
	}
	return result.value;
}

describe("parseBridgePayload", () => {
	it("accepts schema_version=2 revocation payloads and preserves access_removed", () => {
		const result = parseBridgePayload({
			schema_version: 2,
			event_kind: "unlimited_period_reversed",
			stripe_event_id: "evt_refund_2",
			account_id: ACCOUNT_ID,
			stripe_subscription_id: "sub_123",
			subscription_period_end: "2026-05-01T00:00:00Z",
			reason: "chargeback",
			access_removed: false,
		});

		expect(expectOk(result)).toEqual({
			event_kind: "unlimited_period_reversed",
			stripe_event_id: "evt_refund_2",
			account_id: ACCOUNT_ID,
			stripe_subscription_id: "sub_123",
			subscription_period_end: "2026-05-01T00:00:00Z",
			reason: "chargeback",
			access_removed: false,
		});
	});

	it("accepts schema_version=2 non-revocation payloads", () => {
		const result = parseBridgePayload({
			schema_version: 2,
			event_kind: "pack_fulfilled",
			stripe_event_id: "evt_pack_1",
			account_id: ACCOUNT_ID,
			bonus_unlocked_song_ids: ["22222222-2222-4222-8222-222222222222"],
		});

		expect(expectOk(result)).toEqual({
			event_kind: "pack_fulfilled",
			stripe_event_id: "evt_pack_1",
			account_id: ACCOUNT_ID,
			bonus_unlocked_song_ids: ["22222222-2222-4222-8222-222222222222"],
		});
	});

	it("treats non-current schema versions as unsupported", () => {
		const result = parseBridgePayload({
			schema_version: 1,
			event_kind: "pack_reversed",
			stripe_event_id: "evt_refund_3",
			account_id: ACCOUNT_ID,
			pack_stripe_event_id: "evt_pack_3",
			reason: "refund",
			access_removed: true,
		});

		expect(Result.isError(result)).toBe(true);
		if (Result.isOk(result)) {
			throw new Error("Expected schema version rejection");
		}

		expect(result.error).toEqual({
			kind: "unsupported_schema_version",
			eventKind: "pack_reversed",
			schemaVersion: 1,
		});
	});

	it("rejects missing schema_version as invalid payload", () => {
		const result = parseBridgePayload({
			event_kind: "pack_reversed",
			stripe_event_id: "evt_refund_4",
			account_id: ACCOUNT_ID,
			pack_stripe_event_id: "evt_pack_4",
			reason: "refund",
			access_removed: true,
		});

		expect(Result.isError(result)).toBe(true);
		if (Result.isOk(result)) {
			throw new Error("Expected invalid payload rejection");
		}

		expect(result.error).toEqual({ kind: "invalid_payload" });
	});

	it("rejects malformed schema_version=2 revocation payloads", () => {
		const result = parseBridgePayload({
			schema_version: 2,
			event_kind: "pack_reversed",
			stripe_event_id: "evt_refund_5",
			account_id: ACCOUNT_ID,
			pack_stripe_event_id: "evt_pack_5",
			reason: "refund",
		});

		expect(Result.isError(result)).toBe(true);
		if (Result.isOk(result)) {
			throw new Error("Expected invalid payload rejection");
		}

		expect(result.error).toEqual({ kind: "invalid_payload" });
	});
});
