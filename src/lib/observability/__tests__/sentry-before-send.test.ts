import type { ErrorEvent, EventHint } from "@sentry/core";
import { describe, expect, it } from "vitest";
import { DatabaseError } from "@/lib/shared/errors/database";
import { applyServerErrorFingerprint } from "../sentry-before-send";

const TIMEOUT_FINGERPRINT = ["db-statement-timeout"];

function event(overrides: Partial<ErrorEvent> = {}): ErrorEvent {
	return { type: undefined, ...overrides } as ErrorEvent;
}

describe("applyServerErrorFingerprint", () => {
	it("collapses a timeout identified by the db_code tag", () => {
		const result = applyServerErrorFingerprint(
			event({ tags: { db_code: "57014" } }),
			{} as EventHint,
		);
		expect(result.fingerprint).toEqual(TIMEOUT_FINGERPRINT);
	});

	it("collapses a timeout identified by the original exception's code", () => {
		const err = new DatabaseError({
			code: "57014",
			message: "canceling statement due to statement timeout",
		});
		const result = applyServerErrorFingerprint(event(), {
			originalException: err,
		} as EventHint);
		expect(result.fingerprint).toEqual(TIMEOUT_FINGERPRINT);
	});

	it("collapses a timeout identified by message alone (no code/tag)", () => {
		const result = applyServerErrorFingerprint(event(), {
			originalException: new Error(
				"canceling statement due to statement timeout",
			),
		} as EventHint);
		expect(result.fingerprint).toEqual(TIMEOUT_FINGERPRINT);
	});

	it("leaves grouping untouched for unrelated DB errors", () => {
		const err = new DatabaseError({ code: "PGRST202", message: "boom" });
		const result = applyServerErrorFingerprint(
			event({ tags: { db_code: "PGRST202" } }),
			{ originalException: err } as EventHint,
		);
		expect(result.fingerprint).toBeUndefined();
	});

	it("leaves grouping untouched for a plain error", () => {
		const result = applyServerErrorFingerprint(event(), {
			originalException: new Error("network down"),
		} as EventHint);
		expect(result.fingerprint).toBeUndefined();
	});
});
