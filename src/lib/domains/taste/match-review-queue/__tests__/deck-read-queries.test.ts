import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — the two RPC wrappers are thin: fire the admin-client RPC, translate a
// PostgREST error, and (P1.5) fire captureServerError when the JSONB payload's
// `status` discriminator falls outside the known allowlist while STILL returning
// the value. Both collaborators are mocked so the test is DB-free and asserts the
// drift-capture seam directly.
// ---------------------------------------------------------------------------

const mockRpc = vi.fn();
const mockCaptureServerError = vi.fn();

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: () => ({
		rpc: (...a: unknown[]) => mockRpc(...a),
	}),
}));

vi.mock("@/lib/observability/capture-server-error", () => ({
	captureServerError: (...a: unknown[]) => mockCaptureServerError(...a),
}));

import {
	callReadMatchDeckCard,
	callStartOrResumeMatchDeck,
} from "../deck-read-queries";

beforeEach(() => {
	vi.clearAllMocks();
});

describe("callStartOrResumeMatchDeck drift capture", () => {
	it("captures an unknown status once but still returns Result.ok with the raw value", async () => {
		mockRpc.mockResolvedValue({ data: { status: "renamed" }, error: null });

		const result = await callStartOrResumeMatchDeck(
			"acct-1",
			"playlist",
			"vc_playlist_0.5_rtf",
		);

		// The value flows through unchanged — the mappers' fallback arms handle an
		// unexpected status; the capture only makes the drift visible.
		if (Result.isError(result)) throw new Error("expected ok");
		expect(result.value.status).toBe("renamed");

		expect(mockCaptureServerError).toHaveBeenCalledTimes(1);
		const [, contextArg] = mockCaptureServerError.mock.calls[0];
		expect(contextArg).toMatchObject({
			operation: "call_start_or_resume_match_deck",
			accountId: "acct-1",
			extra: { orientation: "playlist", status: "renamed" },
		});
	});

	it("does not capture on a known status (miss)", async () => {
		mockRpc.mockResolvedValue({
			data: { status: "miss", reason: "no_ready_proposal" },
			error: null,
		});

		const result = await callStartOrResumeMatchDeck("acct-1", "song", null);

		if (Result.isError(result)) throw new Error("expected ok");
		expect(result.value.status).toBe("miss");
		expect(mockCaptureServerError).not.toHaveBeenCalled();
	});
});

describe("callReadMatchDeckCard drift capture", () => {
	it("captures an unknown status once but still returns Result.ok with the raw value", async () => {
		mockRpc.mockResolvedValue({ data: { status: "renamed" }, error: null });

		const result = await callReadMatchDeckCard("item-1", "acct-1");

		if (Result.isError(result)) throw new Error("expected ok");
		expect(result.value.status).toBe("renamed");

		expect(mockCaptureServerError).toHaveBeenCalledTimes(1);
		const [, contextArg] = mockCaptureServerError.mock.calls[0];
		expect(contextArg).toMatchObject({
			operation: "call_read_match_deck_card",
			accountId: "acct-1",
			extra: { itemId: "item-1", status: "renamed" },
		});
	});

	it("does not capture on a known status (ready)", async () => {
		mockRpc.mockResolvedValue({ data: { status: "ready" }, error: null });

		const result = await callReadMatchDeckCard("item-1", "acct-1");

		if (Result.isError(result)) throw new Error("expected ok");
		expect(result.value.status).toBe("ready");
		expect(mockCaptureServerError).not.toHaveBeenCalled();
	});
});
