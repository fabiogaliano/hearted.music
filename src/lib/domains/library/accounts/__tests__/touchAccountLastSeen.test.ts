/**
 * Tests for touchAccountLastSeen.
 *
 * PostgREST returns DB errors in-band ({ error } on a resolved promise), so the
 * key guarantee is that an in-band error is surfaced (thrown) rather than
 * silently discarded — otherwise the fire-and-forget heartbeat could fail with
 * zero visibility.
 */

import { describe, expect, it, vi } from "vitest";

const { mockRpc } = vi.hoisted(() => ({ mockRpc: vi.fn() }));

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: () => ({ rpc: mockRpc }),
}));

import { touchAccountLastSeen } from "@/lib/domains/library/accounts/queries";

describe("touchAccountLastSeen", () => {
	it("calls the throttled RPC with the account id", async () => {
		mockRpc.mockResolvedValue({ data: null, error: null });

		await touchAccountLastSeen("acct-1");

		expect(mockRpc).toHaveBeenCalledWith("touch_account_last_seen", {
			p_account_id: "acct-1",
		});
	});

	it("resolves when the RPC succeeds", async () => {
		mockRpc.mockResolvedValue({ data: null, error: null });

		await expect(touchAccountLastSeen("acct-1")).resolves.toBeUndefined();
	});

	it("throws when PostgREST returns an in-band error", async () => {
		mockRpc.mockResolvedValue({
			data: null,
			error: { code: "42883", message: "function does not exist" },
		});

		await expect(touchAccountLastSeen("acct-1")).rejects.toThrow();
	});
});
