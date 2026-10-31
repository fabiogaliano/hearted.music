import { describe, expect, it } from "vitest";
import { returnPathSchema } from "../return-path";

describe("returnPathSchema", () => {
	it("keeps a same-origin deep link with its query", () => {
		expect(
			returnPathSchema.parse("/liked-songs?song=kae-tempest-firesmoke"),
		).toBe("/liked-songs?song=kae-tempest-firesmoke");
	});

	it.each([
		"//evil.example",
		"/\\evil.example",
		"https://evil.example/liked-songs",
		"javascript:alert(1)",
		"liked-songs",
	])("drops %s so sign-in can't redirect off-site", (value) => {
		expect(returnPathSchema.parse(value)).toBeUndefined();
	});
});
