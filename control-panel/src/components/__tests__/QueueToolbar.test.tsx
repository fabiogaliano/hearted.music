// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QueueToolbar, type QueueToolbarProps } from "../QueueToolbar";

function renderToolbar(overrides: Partial<QueueToolbarProps> = {}) {
	const props: QueueToolbarProps = {
		search: "",
		onSearchChange: vi.fn(),
		order: "oldest",
		onOrderChange: vi.fn(),
		mode: "focus",
		onModeChange: vi.fn(),
		pageSize: 50,
		onPageSizeChange: vi.fn(),
		onReset: vi.fn(),
		total: 12,
		page: 1,
		onPrev: vi.fn(),
		onNext: vi.fn(),
		hasPrev: false,
		hasNext: true,
		...overrides,
	};
	return { props, ...render(<QueueToolbar {...props} />) };
}

describe("QueueToolbar", () => {
	it("shows a focus-mode card position when focusIndex is provided", () => {
		renderToolbar({ focusIndex: 0, total: 12, page: 1, pageSize: 50 });
		expect(screen.getByText("1 of 12")).toBeTruthy();
	});

	it("shows a list-mode range when focusIndex is omitted", () => {
		renderToolbar({ total: 12, page: 1, pageSize: 50 });
		expect(screen.getByText("1–12 of 12")).toBeTruthy();
	});

	it("disables the previous control and enables next per the flags", () => {
		renderToolbar({ hasPrev: false, hasNext: true });
		const prev = screen.getByRole("button", { name: /previous/i });
		const next = screen.getByRole("button", { name: /next/i });
		expect((prev as HTMLButtonElement).disabled).toBe(true);
		expect((next as HTMLButtonElement).disabled).toBe(false);
	});

	it("debounces search input before calling onSearchChange", () => {
		vi.useFakeTimers();
		try {
			const onSearchChange = vi.fn();
			renderToolbar({ onSearchChange });
			fireEvent.change(screen.getByPlaceholderText(/search title or artist/i), {
				target: { value: "oasis" },
			});
			expect(onSearchChange).not.toHaveBeenCalled();
			vi.advanceTimersByTime(250);
			expect(onSearchChange).toHaveBeenCalledWith("oasis");
		} finally {
			vi.useRealTimers();
		}
	});

	it("toggles mode via the Focus/List group", () => {
		const onModeChange = vi.fn();
		renderToolbar({ mode: "focus", onModeChange });
		fireEvent.click(screen.getByRole("button", { name: "List mode" }));
		expect(onModeChange).toHaveBeenCalledWith("list");
	});
});
