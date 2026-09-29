// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
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

	it("opens a detail drawer and deep-links an account target to User Detail", () => {
		renderSection();
		fireEvent.click(screen.getByRole("button", { name: /view/i }));
		const drawer = screen.getByRole("dialog");
		// Input summary and result are shown as JSON.
		expect(within(drawer).getByText(/newlyUnlocked/)).toBeTruthy();
		fireEvent.click(
			within(drawer).getByRole("button", { name: /open target/i }),
		);
		expect(navigate).toHaveBeenCalledWith("users", { user: "acct-1" });
	});
});
