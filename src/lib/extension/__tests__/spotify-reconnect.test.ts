import { describe, expect, it } from "vitest";
import type { CommandResponse } from "../../../../shared/spotify-command-protocol";
import { requiresSpotifyReconnect } from "../spotify-reconnect";

describe("requiresSpotifyReconnect", () => {
	it("returns false for successful responses", () => {
		const ok: CommandResponse<unknown> = {
			ok: true,
			data: {},
			commandId: "c1",
		};
		expect(requiresSpotifyReconnect(ok)).toBe(false);
	});

	it("returns true for AUTH_REQUIRED", () => {
		const err: CommandResponse<unknown> = {
			ok: false,
			errorCode: "AUTH_REQUIRED",
			message: "No valid token",
			retryable: false,
			commandId: "c1",
		};
		expect(requiresSpotifyReconnect(err)).toBe(true);
	});

	it("returns true for TOKEN_EXPIRED", () => {
		const err: CommandResponse<unknown> = {
			ok: false,
			errorCode: "TOKEN_EXPIRED",
			message: "Token expired",
			retryable: false,
			commandId: "c1",
		};
		expect(requiresSpotifyReconnect(err)).toBe(true);
	});

	it("returns false for non-auth errors", () => {
		const err: CommandResponse<unknown> = {
			ok: false,
			errorCode: "NETWORK_ERROR",
			message: "offline",
			retryable: true,
			commandId: "c1",
		};
		expect(requiresSpotifyReconnect(err)).toBe(false);
	});
});
