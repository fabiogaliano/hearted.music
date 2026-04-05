import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { KeyboardShortcutProvider } from "@/lib/keyboard/KeyboardShortcutProvider";
import { useListCursor } from "@/lib/keyboard/useListCursor";
import { useListNavigation } from "@/lib/keyboard/useListNavigation";
import { ThemeHueProvider } from "@/lib/theme/ThemeHueProvider";

const ITEMS = ["first", "second", "third"] as const;

function CursorHarness() {
	const { getItemProps, interactionMode, syncFocusedIndex } = useListCursor({
		items: ITEMS,
		getId: (item) => item,
	});

	return (
		<div>
			<button
				type="button"
				onClick={() => {
					syncFocusedIndex(1, {
						focus: true,
						mode: "keyboard",
						source: "keyboard",
					});
				}}
			>
				focus second with keyboard
			</button>
			<div data-testid="interaction-mode">{interactionMode}</div>
			{ITEMS.map((item, index) => {
				const itemProps = getItemProps(item, index);
				return (
					<button
						key={item}
						type="button"
						ref={itemProps.ref}
						tabIndex={itemProps.tabIndex}
						data-focused={itemProps["data-focused"]}
						data-nav-engaged={itemProps["data-nav-engaged"]}
						onPointerDown={itemProps.onPointerDown}
						onFocus={itemProps.onFocus}
						onBlur={itemProps.onBlur}
					>
						{item}
					</button>
				);
			})}
		</div>
	);
}

function NavigationHarness() {
	const { getItemProps } = useListNavigation({
		items: ITEMS,
		scope: "liked-list",
		getId: (item) => item,
		scrollBlock: "center",
	});

	return (
		<div>
			{ITEMS.map((item, index) => {
				const itemProps = getItemProps(item, index);
				return (
					<button
						key={item}
						type="button"
						ref={itemProps.ref}
						tabIndex={itemProps.tabIndex}
						data-focused={itemProps["data-focused"]}
						data-nav-engaged={itemProps["data-nav-engaged"]}
						onPointerDown={itemProps.onPointerDown}
						onFocus={itemProps.onFocus}
						onBlur={itemProps.onBlur}
					>
						{item}
					</button>
				);
			})}
		</div>
	);
}

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("useListCursor", () => {
	it("keeps keyboard focus styling separate from pointer interaction", () => {
		render(<CursorHarness />);

		fireEvent.click(
			screen.getByRole("button", { name: "focus second with keyboard" }),
		);

		const second = screen.getByRole("button", { name: "second" });
		expect(screen.getByTestId("interaction-mode")).toHaveTextContent(
			"keyboard",
		);
		expect(second).toHaveAttribute("data-focused", "true");
		expect(second).toHaveAttribute("data-nav-engaged", "true");

		const first = screen.getByRole("button", { name: "first" });
		fireEvent.pointerDown(first);
		fireEvent.focus(first);

		expect(screen.getByTestId("interaction-mode")).toHaveTextContent("pointer");
		expect(first).toHaveAttribute("data-focused", "false");
		expect(first).toHaveAttribute("data-nav-engaged", "false");
	});
});

describe("useListNavigation", () => {
	it("auto-scrolls keyboard navigation but not pointer selection", () => {
		const scrollIntoViewSpy = vi.fn();
		Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
			configurable: true,
			value: scrollIntoViewSpy,
		});

		render(
			<ThemeHueProvider>
				<KeyboardShortcutProvider>
					<NavigationHarness />
				</KeyboardShortcutProvider>
			</ThemeHueProvider>,
		);

		fireEvent.keyDown(window, { key: "j" });
		expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);
		expect(scrollIntoViewSpy).toHaveBeenLastCalledWith({
			behavior: "auto",
			block: "center",
			inline: "nearest",
		});

		const second = screen.getByRole("button", { name: "second" });
		fireEvent.pointerDown(second);
		fireEvent.focus(second);

		expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);
	});
});
