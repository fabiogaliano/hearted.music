import { Result } from "better-result";
import { describe, expect, it } from "vitest";
import { DatabaseError } from "@/lib/shared/errors/database";
import {
	resolveReadinessConservative,
	resolveReadinessPermissive,
} from "../readiness";

const dbErr = Result.err(
	new DatabaseError({ code: "08006", message: "connection lost" }),
);

describe("resolveReadinessConservative", () => {
	it("returns false on DB error — UI must not falsely claim ready when DB state is unknown", () => {
		expect(resolveReadinessConservative(dbErr)).toBe(false);
	});

	it("returns true when the DB confirms a visible subject exists", () => {
		expect(resolveReadinessConservative(Result.ok(true))).toBe(true);
	});

	it("returns false when the DB confirms no visible subject exists", () => {
		expect(resolveReadinessConservative(Result.ok(false))).toBe(false);
	});
});

describe("resolveReadinessPermissive", () => {
	it("returns true on DB error — avoids spamming bootstrap on transient failures", () => {
		expect(resolveReadinessPermissive(dbErr)).toBe(true);
	});

	it("returns true when the DB confirms a visible subject exists", () => {
		expect(resolveReadinessPermissive(Result.ok(true))).toBe(true);
	});

	it("returns false when the DB confirms no visible subject exists", () => {
		expect(resolveReadinessPermissive(Result.ok(false))).toBe(false);
	});
});
