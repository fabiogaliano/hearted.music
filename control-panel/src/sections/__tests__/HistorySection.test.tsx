// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NavContext } from "../../lib/navigation";
import type { ActionRunRow } from "../../lib/types";

const navigate = vi.fn();

vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

const run: ActionRunRow = {
	id: "run-1",
	prodRef: "prod-abc",
	actionType: "grant-access",
	mode: "commit",
	targetType: "account",
	targetId: "acct-1",
	targetLabel: "Ada Lovelace",
	inputSummary: { grantType: "songs", limit: 500 },
	status: "succeeded",
	resultSummary: { status: "applied", newlyUnlocked: 12 },
	errorMessage: null,
	externalId: null,
	startedAt: new Date().toISOString(),
	completedAt: new Date().toISOString(),
	parentRunId: null,
};

vi.mock("../../lib/api", () => ({
	useApi: (path: string) => {
		if (path.startsWith("/api/history/summary")) {
			return {
				data: { commits: 3, dryRuns: 1, failedOrPartial: 0 },
				error: null,
				loading: false,
				refreshing: false,
				fetchedAt: Date.now(),
				refetch: vi.fn(),
			};
		}
		return {
			data: { rows: [run], total: 1, page: 1, pageSize: 50 },
			error: null,
			loading: false,
			refreshing: false,
			fetchedAt: Date.now(),
			refetch: vi.fn(),
		};
	},
}));

import { HistorySection } from "../HistorySection";

function renderSection() {
	return render(
		<NavContext.Provider value={navigate}>
			<HistorySection refreshKey={0} />
		</NavContext.Provider>,
	);
}

describe("HistorySection", () => {
	beforeEach(() => {
		navigate.mockClear();
		window.history.replaceState({}, "", "/?section=history");
	});

	it("renders today's summary counts and a run row", () => {
		renderSection();
		expect(screen.getByText("Commits today")).toBeTruthy();
		// "grant-access" also appears as a filter <option>; the row cell is the extra.
		expect(screen.getAllByText("grant-access").length).toBeGreaterThan(1);
		expect(screen.getByText("Ada Lovelace")).toBeTruthy();
	});

	it("opens a detail drawer and deep-links an account target to User Detail", () => {
		renderSection();
		fireEvent.click(screen.getByText("View"));
		expect(screen.getByText("Action run")).toBeTruthy();
		// Input summary and result are shown as JSON.
		expect(screen.getByText(/newlyUnlocked/)).toBeTruthy();
		fireEvent.click(screen.getByText("Open target"));
		expect(navigate).toHaveBeenCalledWith("users", { user: "acct-1" });
	});
});
