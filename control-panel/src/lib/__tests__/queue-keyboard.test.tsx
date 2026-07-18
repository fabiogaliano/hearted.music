// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { type QueueKeyHandlers, useQueueKeyboard } from "../queue-keyboard";

function Harness({
	handlers,
	enabled = true,
}: {
	handlers: QueueKeyHandlers;
	enabled?: boolean;
}) {
	useQueueKeyboard(handlers, enabled);
	return (
		<div>
			<input aria-label="field" />
			<textarea aria-label="area" />
		</div>
	);
}

describe("useQueueKeyboard", () => {
	it("maps J/K/A// to their handlers", () => {
		const handlers = {
			onNext: vi.fn(),
			onPrev: vi.fn(),
			onApprove: vi.fn(),
			onSearch: vi.fn(),
		};
		render(<Harness handlers={handlers} />);
		fireEvent.keyDown(window, { key: "j" });
		fireEvent.keyDown(window, { key: "k" });
		fireEvent.keyDown(window, { key: "a" });
		fireEvent.keyDown(window, { key: "/" });
		expect(handlers.onNext).toHaveBeenCalledTimes(1);
		expect(handlers.onPrev).toHaveBeenCalledTimes(1);
		expect(handlers.onApprove).toHaveBeenCalledTimes(1);
		expect(handlers.onSearch).toHaveBeenCalledTimes(1);
	});

	it("ignores letter shortcuts while typing in a field", () => {
		const onApprove = vi.fn();
		const { getByLabelText } = render(<Harness handlers={{ onApprove }} />);
		fireEvent.keyDown(getByLabelText("field"), { key: "a" });
		fireEvent.keyDown(getByLabelText("area"), { key: "a" });
		expect(onApprove).not.toHaveBeenCalled();
	});

	it("still delivers Escape from within a field so a form can close", () => {
		const onEscape = vi.fn();
		const { getByLabelText } = render(<Harness handlers={{ onEscape }} />);
		fireEvent.keyDown(getByLabelText("field"), { key: "Escape" });
		expect(onEscape).toHaveBeenCalledTimes(1);
	});

	it("does not fire modified keypresses", () => {
		const onNext = vi.fn();
		render(<Harness handlers={{ onNext }} />);
		fireEvent.keyDown(window, { key: "j", metaKey: true });
		expect(onNext).not.toHaveBeenCalled();
	});

	it("detaches its listener when disabled", () => {
		const onNext = vi.fn();
		render(<Harness handlers={{ onNext }} enabled={false} />);
		fireEvent.keyDown(window, { key: "j" });
		expect(onNext).not.toHaveBeenCalled();
	});
});
