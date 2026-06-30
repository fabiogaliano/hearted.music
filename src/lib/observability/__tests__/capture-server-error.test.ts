import { beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseError, NotFoundError } from "@/lib/shared/errors/database";
import { captureServerError } from "../capture-server-error";

const { mockCaptureException } = vi.hoisted(() => ({
	mockCaptureException: vi.fn(),
}));

vi.mock("@sentry/cloudflare", () => ({
	captureException: (...args: unknown[]) => mockCaptureException(...args),
}));

describe("captureServerError", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("promotes operation/area to tags and accountId to user.id", () => {
		const err = new NotFoundError("playlist", "abc");
		captureServerError(err, {
			operation: "save_playlist_match_intent",
			area: "playlists",
			accountId: "acct-1",
		});

		// Assert by identity (toBe): TaggedError is an IterableError, so a deep
		// structural match would iterate the error and panic.
		const [captured, context] = mockCaptureException.mock.calls[0] ?? [];
		expect(captured).toBe(err);
		expect(context).toMatchObject({
			tags: {
				operation: "save_playlist_match_intent",
				area: "playlists",
				db_error: "NotFoundError",
			},
			user: { id: "acct-1" },
		});
	});

	it("promotes a DatabaseError's code to the db_code tag", () => {
		const err = new DatabaseError({ code: "PGRST202", message: "boom" });
		captureServerError(err, { operation: "get_billing_state" });

		const [, context] = mockCaptureException.mock.calls[0] ?? [];
		expect(context).toMatchObject({
			tags: { operation: "get_billing_state", db_code: "PGRST202" },
		});
	});

	it("omits db_* tags and user for a plain error with no account", () => {
		const err = new Error("network down");
		captureServerError(err, { operation: "create_checkout_session" });

		const [captured, context] = mockCaptureException.mock.calls[0] ?? [];
		expect(captured).toBe(err);
		expect(context.tags).toEqual({ operation: "create_checkout_session" });
		expect(context.user).toBeUndefined();
	});
});
