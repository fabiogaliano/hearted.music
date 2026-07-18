// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
	deleteSavedView,
	findSavedViewByName,
	listSavedViews,
	saveView,
} from "../saved-views";

describe("saved views", () => {
	beforeEach(() => {
		window.localStorage.clear();
	});

	it("saves and lists a view", () => {
		saveView("Failed audio", "audio-review", "view=approved&status=rejected");

		const views = listSavedViews();
		expect(views).toHaveLength(1);
		expect(views[0]).toMatchObject({
			label: "Failed audio",
			section: "audio-review",
			params: "view=approved&status=rejected",
		});
	});

	it("rejects an empty name", () => {
		expect(() => saveView("   ", "users", "")).toThrow(/must not be empty/i);
	});

	it("finds a saved view case-insensitively", () => {
		saveView("Stale Jobs", "jobs", "view=runs&rStale=true");
		expect(findSavedViewByName("stale jobs")?.label).toBe("Stale Jobs");
		expect(findSavedViewByName("missing")).toBeNull();
	});

	it("replaces a duplicate name in place instead of adding a second entry", () => {
		saveView("Grants", "billing", "view=grants&gStatus=pending");
		saveView("grants", "billing", "view=grants&gStatus=applied");

		const views = listSavedViews();
		expect(views).toHaveLength(1);
		expect(views[0]?.params).toBe("view=grants&gStatus=applied");
	});

	it("enforces the 30-view cap for new names", () => {
		for (let i = 0; i < 30; i += 1) {
			saveView(`View ${i}`, "users", "");
		}
		expect(() => saveView("One too many", "users", "")).toThrow(
			/limited to 30/i,
		);
	});

	it("deletes a view by id", () => {
		saveView("Temp", "library", "");
		const views = listSavedViews();
		expect(views).toHaveLength(1);
		deleteSavedView(views[0].id);
		expect(listSavedViews()).toHaveLength(0);
	});
});
