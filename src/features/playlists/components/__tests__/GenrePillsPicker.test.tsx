/**
 * Keyboard selection for the genre pill picker.
 *
 * The picker has no stored "active option" — `activeIndex` is derived from an
 * arrow-key cursor that starts at -1 meaning "the top match". Two bugs that
 * shape invites: Enter doing nothing before the first arrow press, and the
 * arrow keys stepping off the stale cursor instead of the derived index, so
 * the popover highlight and what Enter adds drift apart.
 */

import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@/test/utils/render";
import { GenrePillsPicker } from "../GenrePillsPicker";

beforeAll(() => {
	// jsdom has no layout, so the picker's scroll-the-active-row effect throws.
	Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
		configurable: true,
		value: vi.fn(),
	});
});

function selectedOptionLabel(): string {
	const selected = screen
		.getAllByRole("option")
		.filter((option) => option.getAttribute("aria-selected") === "true");
	expect(selected).toHaveLength(1);
	return selected[0].textContent ?? "";
}

describe("GenrePillsPicker keyboard selection", () => {
	it("adds the top match on Enter before any arrow key", async () => {
		const onChange = vi.fn();
		const { user } = render(
			<GenrePillsPicker value={[]} onChange={onChange} />,
		);

		await user.click(screen.getByRole("combobox", { name: /add genre/i }));
		await user.keyboard("rock");

		const top = screen.getAllByRole("option")[0].textContent;
		await user.keyboard("{Enter}");

		expect(onChange).toHaveBeenCalledWith([top]);
	});

	it("adds the option the popover highlights after arrowing", async () => {
		const onChange = vi.fn();
		const { user } = render(
			<GenrePillsPicker value={[]} onChange={onChange} />,
		);

		await user.click(screen.getByRole("combobox", { name: /add genre/i }));
		await user.keyboard("rock");
		// Down twice then up: lands on the second row, not the third or the first.
		await user.keyboard("{ArrowDown}{ArrowDown}{ArrowUp}");

		const rows = screen.getAllByRole("option");
		expect(selectedOptionLabel()).toBe(rows[1].textContent);

		await user.keyboard("{Enter}");

		expect(onChange).toHaveBeenCalledWith([rows[1].textContent]);
	});
});
