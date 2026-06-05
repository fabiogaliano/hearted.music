import { describe, expect, it } from "vitest";
import { hashAnnotationText } from "../annotation-hash";

describe("hashAnnotationText", () => {
	it("is deterministic and ad_-prefixed", async () => {
		const a = await hashAnnotationText("some normalized text");
		const b = await hashAnnotationText("some normalized text");
		expect(a).toBe(b);
		expect(a).toMatch(/^ad_[0-9a-f]{16}$/);
	});

	it("differs for different text", async () => {
		const a = await hashAnnotationText("text one");
		const b = await hashAnnotationText("text two");
		expect(a).not.toBe(b);
	});
});
