// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getJson } = vi.hoisted(() => ({ getJson: vi.fn() }));

vi.mock("../../lib/api", () => ({ getJson }));

import { CommandPalette } from "../CommandPalette";

const navigate = vi.fn();
const close = vi.fn();
const focusTableSearch = vi.fn();

function renderPalette() {
	return render(
		<CommandPalette
			sections={[
				{ key: "overview", label: "Overview" },
				{ key: "users", label: "Users" },
				{ key: "email", label: "Send email" },
			]}
			onNavigate={navigate}
			onClose={close}
			onFocusTableSearch={focusTableSearch}
		/>,
	);
}

describe("CommandPalette", () => {
	beforeEach(() => {
		window.localStorage.clear();
		navigate.mockClear();
		close.mockClear();
		focusTableSearch.mockClear();
		getJson.mockReset();
	});

	it("navigates to sections and opens saved views", () => {
		window.localStorage.setItem(
			"hearted-control-panel.saved-views.v1",
			JSON.stringify([
				{
					id: "view-1",
					label: "Pending grants",
					section: "billing",
					params: "status=pending",
					createdAt: "2026-01-01T00:00:00.000Z",
				},
			]),
		);
		renderPalette();

		fireEvent.click(screen.getByRole("button", { name: "Users" }));
		expect(navigate).toHaveBeenCalledWith("users", undefined);
		expect(close).toHaveBeenCalled();

		fireEvent.click(screen.getByRole("button", { name: /Pending grants/ }));
		expect(navigate).toHaveBeenLastCalledWith("billing", {
			status: "pending",
		});
	});

	it("searches and opens an account without exposing a mutation command", async () => {
		getJson.mockResolvedValue({
			accounts: [
				{
					id: "account-1",
					label: "Ada Lovelace",
					email: "ada@example.com",
					handle: null,
					activeLiked: 3,
				},
			],
		});
		renderPalette();
		fireEvent.change(
			screen.getByPlaceholderText("Search sections, views, or accounts…"),
			{ target: { value: "Ada" } },
		);

		await waitFor(() => expect(getJson).toHaveBeenCalled());
		expect(screen.getByRole("button", { name: /Ada Lovelace/ })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: /Ada Lovelace/ }));
		expect(navigate).toHaveBeenCalledWith("users", { user: "account-1" });
	});

	it("focuses the current table search and closes on Escape", () => {
		renderPalette();
		fireEvent.click(screen.getByRole("button", { name: /Focus table search/ }));
		expect(close).toHaveBeenCalled();
		window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
		expect(close).toHaveBeenCalledTimes(2);
	});
});
