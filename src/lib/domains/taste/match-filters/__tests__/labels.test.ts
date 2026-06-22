import { describe, expect, it } from "vitest";
import { languageLabel } from "../labels";

describe("languageLabel", () => {
	it("returns label for a known code", () => {
		expect(languageLabel("en")).toBe("English");
		expect(languageLabel("pt")).toBe("Portuguese");
	});

	it("falls back to the code for an unknown code", () => {
		expect(languageLabel("xx-unknown")).toBe("xx-unknown");
	});
});
