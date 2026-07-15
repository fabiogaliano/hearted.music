import { describe, expect, it } from "vitest";
import { canonicalUrl, parseUrlState } from "../url-state";

const userId = "123e4567-e89b-12d3-a456-426614174000";

describe("control-panel URL state", () => {
	it("parses valid navigation and drill-down state", () => {
		const url = new URL(
			`https://panel.test/?section=library&user=${userId}&tierMin=10&tierMax=99&view=approval&q=adele`,
		);

		expect(parseUrlState(url)).toEqual({
			section: "library",
			userId,
			tierMin: 10,
			tierMax: 99,
			view: "approval",
		});
	});

	it("normalizes invalid canonical values without dropping section filters", () => {
		const url = new URL(
			"https://panel.test/?section=unknown&user=not-an-id&tierMin=-1&tierMax=3&view=&q=adele",
		);

		const normalized = canonicalUrl(url);

		expect(parseUrlState(normalized)).toEqual({
			section: "overview",
			userId: null,
			tierMin: null,
			tierMax: null,
			view: null,
		});
		expect(normalized.searchParams.get("q")).toBe("adele");
	});

	it("rejects an inverted tier range", () => {
		const url = new URL("https://panel.test/?tierMin=100&tierMax=10");

		expect(parseUrlState(url).tierMax).toBeNull();
	});
});
