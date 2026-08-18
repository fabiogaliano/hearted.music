import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db");

import { read } from "../db";
import { usersListPage } from "../users-list";

describe("usersListPage", () => {
	beforeEach(() => vi.clearAllMocks());

	it("binds a text search only where its pattern is referenced", async () => {
		const queries: string[] = [];
		const params: unknown[][] = [];
		vi.mocked(read).mockImplementation((async (text: string, values: unknown[] = []) => {
			queries.push(text);
			params.push(values);
			return /count\(\*\) as total/.test(text) ? [{ total: "0" }] : [];
		}) as typeof read);

		await usersListPage(new URL("https://panel.test/api/users/list?q=fabio"));

		expect(queries[0]).toMatch(/a\.email ilike \$1/);
		expect(params[0]).toEqual(["%fabio%"]);
		expect(queries[1]).toMatch(/limit \$2 offset \$3/);
		expect(params[1]).toEqual(["%fabio%", 50, 0]);
	});
});
