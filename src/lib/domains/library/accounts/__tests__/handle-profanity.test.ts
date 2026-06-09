import { describe, expect, it } from "vitest";

import { isProfaneHandle } from "../handle-profanity";

describe("isProfaneHandle", () => {
	it("flags a plain profane word", () => {
		expect(isProfaneHandle("fuck")).toBe(true);
	});

	it("flags separator-obfuscated form using . and _", () => {
		// f.u_c.k → stripped to fuck → matched
		expect(isProfaneHandle("f.u_c.k")).toBe(true);
	});

	it("flags underscore-separated obfuscation", () => {
		expect(isProfaneHandle("s_h_i_t")).toBe(true);
	});

	it("does not flag a clean handle", () => {
		expect(isProfaneHandle("fabio_galiano")).toBe(false);
	});

	it("does not flag another clean handle", () => {
		expect(isProfaneHandle("john_doe")).toBe(false);
	});

	it("does not flag a numeric handle", () => {
		expect(isProfaneHandle("433")).toBe(false);
	});
});
