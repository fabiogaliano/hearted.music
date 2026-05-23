import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
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

const FILTERED_ITEMS = ["third", "fourth"] as const;

function CursorRemapHarness() {
	const [showFiltered, setShowFiltered] = useState(false);
	const items = showFiltered ? FILTERED_ITEMS : ([...ITEMS, "fourth"] as const);
	const { getItemProps, syncFocusedIndex } = useListCursor({
		items,
		getId: (item) => item,
	});

	return (
		<div>
			<button
				type="button"
				onClick={() => {
					syncFocusedIndex(3, {
						focus: true,
						mode: "keyboard",
						source: "keyboard",
					});
				}}
			>
				focus fourth with keyboard
			</button>
			<button type="button" onClick={() => setShowFiltered((prev) => !prev)}>
				toggle filter
			</button>
			{items.map((item, index) => {
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

const DEEP_LIST = ["a", "b", "c", "d", "e", "f", "g"] as const;
const DEEP_SUBSET = ["b", "d", "f"] as const;

function ClampRemapHarness() {
	const [showSubset, setShowSubset] = useState(false);
	const items: readonly string[] = showSubset ? DEEP_SUBSET : DEEP_LIST;
	const { getItemProps, focusedIndex, syncFocusedIndex } = useListCursor({
		items,
		getId: (item) => item,
	});

	return (
		<div>
			<button
				type="button"
				onClick={() => {
					syncFocusedIndex(3, {
						focus: true,
						mode: "keyboard",
						source: "keyboard",
					});
				}}
			>
				focus d
			</button>
			<button
				type="button"
				onClick={() => {
					setShowSubset(true);
				}}
			>
				filter to subset
			</button>
			<button
				type="button"
				onClick={() => {
					setShowSubset(false);
				}}
			>
				show full list
			</button>
			<div data-testid="focused-index">{focusedIndex}</div>
			<div data-testid="focused-label">
				{focusedIndex >= 0 && focusedIndex < items.length
					? items[focusedIndex]
					: "none"}
			</div>
			{items.map((item, index) => {
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

	it("clamp does not overwrite remap when focused index exceeds filtered list length", () => {
		render(<ClampRemapHarness />);

		fireEvent.click(screen.getByRole("button", { name: "focus d" }));
		expect(screen.getByTestId("focused-label")).toHaveTextContent("d");
		expect(screen.getByTestId("focused-index")).toHaveTextContent("3");

		fireEvent.click(screen.getByRole("button", { name: "filter to subset" }));

		expect(screen.getByTestId("focused-label")).toHaveTextContent("d");
		expect(screen.getByTestId("focused-index")).toHaveTextContent("1");
		const dInSubset = screen.getByRole("button", { name: "d" });
		expect(dInSubset).toHaveAttribute("data-focused", "true");
		expect(document.activeElement).toBe(dInSubset);

		fireEvent.click(screen.getByRole("button", { name: "show full list" }));

		expect(screen.getByTestId("focused-label")).toHaveTextContent("d");
		expect(screen.getByTestId("focused-index")).toHaveTextContent("3");
		const dInFull = screen.getByRole("button", { name: "d" });
		expect(dInFull).toHaveAttribute("data-focused", "true");
		expect(document.activeElement).toBe(dInFull);
	});

	it("preserves the focused item when the list is filtered and restored", () => {
		render(<CursorRemapHarness />);

		fireEvent.click(
			screen.getByRole("button", { name: "focus fourth with keyboard" }),
		);

		let fourth = screen.getByRole("button", { name: "fourth" });
		expect(fourth).toHaveAttribute("data-focused", "true");
		expect(document.activeElement).toBe(fourth);

		fireEvent.click(screen.getByRole("button", { name: "toggle filter" }));

		fourth = screen.getByRole("button", { name: "fourth" });
		expect(fourth).toHaveAttribute("data-focused", "true");
		expect(document.activeElement).toBe(fourth);

		fireEvent.click(screen.getByRole("button", { name: "toggle filter" }));

		fourth = screen.getByRole("button", { name: "fourth" });
		expect(fourth).toHaveAttribute("data-focused", "true");
		expect(document.activeElement).toBe(fourth);
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

interface OverflowHarnessOptions {
	onOverflowUp?: () => void;
	onOverflowDown?: () => void;
	onLateralLeft?: () => void;
	onLateralRight?: () => void;
	withNestedControl?: boolean;
}

function OverflowHarness(props: OverflowHarnessOptions) {
	const { getItemProps, focusIndex } = useListNavigation({
		items: ITEMS,
		scope: "liked-list",
		getId: (item) => item,
		onOverflowUp: props.onOverflowUp,
		onOverflowDown: props.onOverflowDown,
		onLateralLeft: props.onLateralLeft,
		onLateralRight: props.onLateralRight,
	});

	return (
		<div>
			<button
				type="button"
				onClick={() => {
					focusIndex(0, { mode: "keyboard" });
				}}
			>
				focus first
			</button>
			<button
				type="button"
				onClick={() => {
					focusIndex(ITEMS.length - 1, { mode: "keyboard" });
				}}
			>
				focus last
			</button>
			{ITEMS.map((item, index) => {
				const itemProps = getItemProps(item, index);
				return (
					// biome-ignore lint/a11y/useSemanticElements: Test harness mirrors production rows that contain nested controls.
					<div
						key={item}
						ref={itemProps.ref}
						role="button"
						tabIndex={itemProps.tabIndex}
						data-focused={itemProps["data-focused"]}
						data-nav-engaged={itemProps["data-nav-engaged"]}
						onPointerDown={itemProps.onPointerDown}
						onFocus={itemProps.onFocus}
						onBlur={itemProps.onBlur}
					>
						<span>{item}</span>
						{props.withNestedControl ? (
							<button type="button" aria-label={`${item} action`}>
								act
							</button>
						) : null}
					</div>
				);
			})}
		</div>
	);
}

describe("useListNavigation overflow + lateral callbacks", () => {
	function mount(harness: React.ReactElement) {
		return render(
			<ThemeHueProvider>
				<KeyboardShortcutProvider>{harness}</KeyboardShortcutProvider>
			</ThemeHueProvider>,
		);
	}

	it("fires onOverflowDown only when pressing Down on the last row", () => {
		const onOverflowDown = vi.fn();
		mount(<OverflowHarness onOverflowDown={onOverflowDown} />);

		fireEvent.click(screen.getByRole("button", { name: "focus first" }));
		fireEvent.keyDown(window, { key: "j" });
		fireEvent.keyDown(window, { key: "j" });
		expect(onOverflowDown).not.toHaveBeenCalled();

		fireEvent.keyDown(window, { key: "j" });
		expect(onOverflowDown).toHaveBeenCalledTimes(1);
	});

	it("fires onOverflowUp only when pressing Up on the first row", () => {
		const onOverflowUp = vi.fn();
		mount(<OverflowHarness onOverflowUp={onOverflowUp} />);

		fireEvent.click(screen.getByRole("button", { name: "focus last" }));
		fireEvent.keyDown(window, { key: "k" });
		fireEvent.keyDown(window, { key: "k" });
		expect(onOverflowUp).not.toHaveBeenCalled();

		fireEvent.keyDown(window, { key: "k" });
		expect(onOverflowUp).toHaveBeenCalledTimes(1);
	});

	it("fires onLateralLeft / onLateralRight on h / l and Left / Right", () => {
		const onLateralLeft = vi.fn();
		const onLateralRight = vi.fn();
		mount(
			<OverflowHarness
				onLateralLeft={onLateralLeft}
				onLateralRight={onLateralRight}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "focus first" }));

		fireEvent.keyDown(window, { key: "l" });
		fireEvent.keyDown(window, { key: "ArrowRight" });
		expect(onLateralRight).toHaveBeenCalledTimes(2);

		fireEvent.keyDown(window, { key: "h" });
		fireEvent.keyDown(window, { key: "ArrowLeft" });
		expect(onLateralLeft).toHaveBeenCalledTimes(2);
	});

	it("suppresses lateral callbacks when focus is on a nested row control", () => {
		const onLateralLeft = vi.fn();
		const onLateralRight = vi.fn();
		mount(
			<OverflowHarness
				onLateralLeft={onLateralLeft}
				onLateralRight={onLateralRight}
				withNestedControl
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "focus first" }));
		const nested = screen.getByRole("button", { name: "first action" });
		nested.focus();

		fireEvent.keyDown(window, { key: "l" });
		fireEvent.keyDown(window, { key: "h" });
		expect(onLateralLeft).not.toHaveBeenCalled();
		expect(onLateralRight).not.toHaveBeenCalled();
	});
});
