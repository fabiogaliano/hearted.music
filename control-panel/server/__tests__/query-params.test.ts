import { describe, expect, it } from "vitest";
import { parseJobRunsQuery } from "../job-lists";
import { parseListQuery, parseQueueQuery } from "../query-params";
import { parseUsersListQuery } from "../users-list";

const columns = ["createdAt", "label", "liked"] as const;

describe("parseListQuery", () => {
	it("parses supported values and trims search", () => {
		const result = parseListQuery(
			new URL("https://panel.test/?q=%20adele%20&page=3&pageSize=100&sort=liked&direction=asc"),
			columns,
			"createdAt",
		);

		expect(result).toEqual({
			q: "adele",
			page: 3,
			pageSize: 100,
			sort: "liked",
			direction: "asc",
		});
	});

	it("normalizes invalid values to safe defaults", () => {
		const result = parseListQuery(
			new URL("https://panel.test/?page=-2&pageSize=12&sort=password&direction=sideways"),
			columns,
			"createdAt",
		);

		expect(result).toEqual({
			q: "",
			page: 1,
			pageSize: 50,
			sort: "createdAt",
			direction: "desc",
		});
	});

	it("parses users filters with safe enum defaults", () => {
		const result = parseUsersListQuery(
			new URL("https://panel.test/?access=unlimited&library=synced&onboarding=complete&lastSeen=7d&plan=pro"),
		);

		expect(result.access).toBe("unlimited");
		expect(result.library).toBe("synced");
		expect(result.onboarding).toBe("complete");
		expect(result.lastSeen).toBe("7d");
		expect(result.plan).toBe("pro");
	});

	it("parses job-runs filters and rejects unknown enum values", () => {
		const result = parseJobRunsQuery(
			new URL("https://panel.test/?type=song_analysis&status=failed&stale=true&accountId=abc&dateFrom=2026-01-01&dateTo=2026-02-01"),
		);

		expect(result.type).toBe("song_analysis");
		expect(result.status).toBe("failed");
		expect(result.stale).toBe("true");
		expect(result.accountId).toBe("abc");
		expect(result.dateFrom).toBe("2026-01-01");
		expect(result.dateTo).toBe("2026-02-01");
	});

	it("normalizes invalid job-runs enum values and defaults stale to all", () => {
		const result = parseJobRunsQuery(
			new URL("https://panel.test/?type=not_a_type&status=deleted"),
		);

		expect(result.type).toBeNull();
		expect(result.status).toBeNull();
		expect(result.stale).toBe("all");
		expect(result.sort).toBe("updatedAt");
	});
});

describe("parseQueueQuery", () => {
	it("parses queue search, order, and paging", () => {
		const result = parseQueueQuery(
			new URL("https://panel.test/?q=%20oasis%20&order=newest&page=4&pageSize=25"),
		);
		expect(result).toEqual({ q: "oasis", order: "newest", page: 4, pageSize: 25 });
	});

	it("normalizes invalid order/page/pageSize and applies the default order", () => {
		const result = parseQueueQuery(
			new URL("https://panel.test/?order=sideways&page=0&pageSize=7"),
			"newest",
		);
		expect(result).toEqual({ q: "", order: "newest", page: 1, pageSize: 50 });
	});
});
