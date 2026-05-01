import { describe, expect, it } from "vitest";
import type { CommandResponse } from "../../../../shared/spotify-command-protocol";
import type { AcknowledgedResult } from "../playlist-write-acknowledgement";
import {
	outcomeFromCommandResponse,
	outcomeFromAcknowledgedResult,
} from "../spotify-action-outcome";

describe("outcomeFromCommandResponse", () => {
	it("returns success for ok responses", () => {
		const r: CommandResponse<unknown> = { ok: true, data: {}, commandId: "c1" };
		expect(outcomeFromCommandResponse(r)).toEqual({ status: "success" });
	});

	it("returns reconnect-required for AUTH_REQUIRED", () => {
		const r: CommandResponse<unknown> = {
			ok: false,
			errorCode: "AUTH_REQUIRED",
			message: "No token",
			retryable: false,
			commandId: "c1",
		};
		expect(outcomeFromCommandResponse(r)).toEqual({
			status: "reconnect-required",
		});
	});

	it("returns reconnect-required for TOKEN_EXPIRED", () => {
		const r: CommandResponse<unknown> = {
			ok: false,
			errorCode: "TOKEN_EXPIRED",
			message: "Expired",
			retryable: false,
			commandId: "c1",
		};
		expect(outcomeFromCommandResponse(r)).toEqual({
			status: "reconnect-required",
		});
	});

	it("returns extension-unavailable for NETWORK_ERROR", () => {
		const r: CommandResponse<unknown> = {
			ok: false,
			errorCode: "NETWORK_ERROR",
			message: "Extension not available",
			retryable: false,
			commandId: "c1",
		};
		expect(outcomeFromCommandResponse(r)).toEqual({
			status: "extension-unavailable",
		});
	});

	it("returns error with errorCode for UPSTREAM_ERROR", () => {
		const r: CommandResponse<unknown> = {
			ok: false,
			errorCode: "UPSTREAM_ERROR",
			message: "Spotify 500",
			retryable: true,
			commandId: "c1",
		};
		expect(outcomeFromCommandResponse(r)).toEqual({
			status: "error",
			errorCode: "UPSTREAM_ERROR",
		});
	});

	it("returns error with errorCode for RATE_LIMITED", () => {
		const r: CommandResponse<unknown> = {
			ok: false,
			errorCode: "RATE_LIMITED",
			message: "Too many requests",
			retryable: true,
			commandId: "c1",
		};
		expect(outcomeFromCommandResponse(r)).toEqual({
			status: "error",
			errorCode: "RATE_LIMITED",
		});
	});
});

describe("outcomeFromAcknowledgedResult", () => {
	it("returns success when ok and acknowledged", () => {
		const r: AcknowledgedResult<{ uri: string; revision: string }> = {
			ok: true,
			data: { uri: "spotify:playlist:1", revision: "r1" },
			acknowledged: true,
		};
		expect(outcomeFromAcknowledgedResult(r)).toEqual({ status: "success" });
	});

	it("returns success when ok but not acknowledged (server failure is non-blocking)", () => {
		const r: AcknowledgedResult<{ uri: string; revision: string }> = {
			ok: true,
			data: { uri: "spotify:playlist:1", revision: "r1" },
			acknowledged: false,
			acknowledgeError: new Error("db down"),
		};
		expect(outcomeFromAcknowledgedResult(r)).toEqual({ status: "success" });
	});

	it("returns reconnect-required when command response is AUTH_REQUIRED", () => {
		const cmd: CommandResponse<{ revision: string }> = {
			ok: false,
			errorCode: "AUTH_REQUIRED",
			message: "expired",
			retryable: false,
			commandId: "c1",
		};
		const r: AcknowledgedResult<{ revision: string }> = {
			ok: false,
			commandResponse: cmd,
		};
		expect(outcomeFromAcknowledgedResult(r)).toEqual({
			status: "reconnect-required",
		});
	});

	it("returns extension-unavailable when command response is NETWORK_ERROR", () => {
		const cmd: CommandResponse<{ revision: string }> = {
			ok: false,
			errorCode: "NETWORK_ERROR",
			message: "not available",
			retryable: false,
			commandId: "c1",
		};
		const r: AcknowledgedResult<{ revision: string }> = {
			ok: false,
			commandResponse: cmd,
		};
		expect(outcomeFromAcknowledgedResult(r)).toEqual({
			status: "extension-unavailable",
		});
	});

	it("returns error for non-auth command failures", () => {
		const cmd: CommandResponse<{ revision: string }> = {
			ok: false,
			errorCode: "UPSTREAM_ERROR",
			message: "Spotify 500",
			retryable: true,
			commandId: "c1",
		};
		const r: AcknowledgedResult<{ revision: string }> = {
			ok: false,
			commandResponse: cmd,
		};
		expect(outcomeFromAcknowledgedResult(r)).toEqual({
			status: "error",
			errorCode: "UPSTREAM_ERROR",
		});
	});
});
