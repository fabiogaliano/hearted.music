import { describe, expect, it } from "vitest";

import { isReservedHandle, validateHandleFormatInput } from "../handle-rules";

describe("validateHandleFormatInput — normalization", () => {
	it("lowercases input before validation", () => {
		const result = validateHandleFormatInput("FabioGaliano");
		expect(result).toEqual({
			status: "valid",
			normalizedHandle: "fabiogaliano",
		});
	});

	it("does NOT trim surrounding whitespace — leading space is invalid_chars", () => {
		const result = validateHandleFormatInput(" fabio ");
		expect(result).toEqual({ status: "invalid", reason: "invalid_chars" });
	});

	it("leading-only space is invalid_chars (whitespace is not trimmed)", () => {
		const result = validateHandleFormatInput(" fabio");
		expect(result).toEqual({ status: "invalid", reason: "invalid_chars" });
	});
});

describe("validateHandleFormatInput — valid examples", () => {
	it.each([
		["a"],
		["433"],
		["_fabio"],
		["fabio_"],
		["fabio__galiano"],
		["fabio._galiano"],
		["fabio_.galiano"],
	])('"%s" is valid', (handle) => {
		const result = validateHandleFormatInput(handle);
		expect(result.status).toBe("valid");
	});
});

describe("validateHandleFormatInput — invalid examples", () => {
	it('".fabio" → leading_period', () => {
		expect(validateHandleFormatInput(".fabio")).toEqual({
			status: "invalid",
			reason: "leading_period",
		});
	});

	it('"fabio." → trailing_period', () => {
		expect(validateHandleFormatInput("fabio.")).toEqual({
			status: "invalid",
			reason: "trailing_period",
		});
	});

	it('"fabio..galiano" → consecutive_periods', () => {
		expect(validateHandleFormatInput("fabio..galiano")).toEqual({
			status: "invalid",
			reason: "consecutive_periods",
		});
	});

	it('"@fabio" → contains_at_sign', () => {
		expect(validateHandleFormatInput("@fabio")).toEqual({
			status: "invalid",
			reason: "contains_at_sign",
		});
	});

	it('"f@bio" → contains_at_sign', () => {
		expect(validateHandleFormatInput("f@bio")).toEqual({
			status: "invalid",
			reason: "contains_at_sign",
		});
	});

	it('"fabio-galiano" → invalid_chars (hyphens not allowed)', () => {
		expect(validateHandleFormatInput("fabio-galiano")).toEqual({
			status: "invalid",
			reason: "invalid_chars",
		});
	});

	it('"fabio galiano" → invalid_chars (spaces not allowed)', () => {
		expect(validateHandleFormatInput("fabio galiano")).toEqual({
			status: "invalid",
			reason: "invalid_chars",
		});
	});

	it('" fabio " → invalid_chars (surrounding whitespace not trimmed)', () => {
		expect(validateHandleFormatInput(" fabio ")).toEqual({
			status: "invalid",
			reason: "invalid_chars",
		});
	});

	it('"fabio!" → invalid_chars', () => {
		expect(validateHandleFormatInput("fabio!")).toEqual({
			status: "invalid",
			reason: "invalid_chars",
		});
	});

	it('"" → empty', () => {
		expect(validateHandleFormatInput("")).toEqual({
			status: "invalid",
			reason: "empty",
		});
	});

	it("31-char handle → too_long", () => {
		expect(validateHandleFormatInput("a".repeat(31))).toEqual({
			status: "invalid",
			reason: "too_long",
		});
	});

	it("30-char handle is valid (boundary)", () => {
		const result = validateHandleFormatInput("a".repeat(30));
		expect(result.status).toBe("valid");
	});
});

describe("validateHandleFormatInput — precedence stability", () => {
	it('"@help" → contains_at_sign (@ before invalid_chars)', () => {
		expect(validateHandleFormatInput("@help")).toEqual({
			status: "invalid",
			reason: "contains_at_sign",
		});
	});

	it('"help." → trailing_period', () => {
		expect(validateHandleFormatInput("help.")).toEqual({
			status: "invalid",
			reason: "trailing_period",
		});
	});

	it('".help" → leading_period', () => {
		expect(validateHandleFormatInput(".help")).toEqual({
			status: "invalid",
			reason: "leading_period",
		});
	});

	it('"foo.." → consecutive_periods', () => {
		expect(validateHandleFormatInput("foo..")).toEqual({
			status: "invalid",
			reason: "consecutive_periods",
		});
	});

	it('"foo ." → invalid_chars (charset checked before period rules)', () => {
		expect(validateHandleFormatInput("foo .")).toEqual({
			status: "invalid",
			reason: "invalid_chars",
		});
	});

	it('".help." → leading_period (leading checked before trailing)', () => {
		expect(validateHandleFormatInput(".help.")).toEqual({
			status: "invalid",
			reason: "leading_period",
		});
	});
});

describe("isReservedHandle", () => {
	it("blocks base reserved words", () => {
		for (const word of [
			"admin",
			"support",
			"help",
			"about",
			"official",
			"hearted",
			"team",
			"staff",
			"null",
			"undefined",
		]) {
			expect(isReservedHandle(word), `expected "${word}" to be reserved`).toBe(
				true,
			);
		}
	});

	it("blocks protected app-language set", () => {
		for (const word of [
			"liked-songs",
			"jukebox",
			"settings",
			"login",
			"faq",
			"privacy",
			"terms",
			"forgot-password",
			"reset-password",
			"verify-email",
		]) {
			expect(isReservedHandle(word), `expected "${word}" to be reserved`).toBe(
				true,
			);
		}
	});

	it("blocks official-ish set", () => {
		for (const word of [
			"verified",
			"moderator",
			"founder",
			"press",
			"security",
			"legal",
			"billing",
			"contact",
		]) {
			expect(isReservedHandle(word), `expected "${word}" to be reserved`).toBe(
				true,
			);
		}
	});

	it("is case-insensitive (normalizes before lookup)", () => {
		expect(isReservedHandle("Admin")).toBe(true);
		expect(isReservedHandle("HELP")).toBe(true);
	});

	it("does not block ordinary user handles", () => {
		expect(isReservedHandle("fabio")).toBe(false);
		expect(isReservedHandle("john_doe")).toBe(false);
	});
});
