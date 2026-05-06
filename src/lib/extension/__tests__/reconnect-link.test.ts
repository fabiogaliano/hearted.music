import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockExpectLoginReturn } = vi.hoisted(() => {
	const mockExpectLoginReturn = vi.fn().mockResolvedValue(true);
	return { mockExpectLoginReturn };
});

vi.mock("../detect", () => ({
	expectLoginReturn: () => mockExpectLoginReturn(),
}));

import type { MouseEvent } from "react";
import { armReconnectOnActivation, shouldArmOnEvent } from "../reconnect-link";

function fakeEvent(
	type: string,
	button: number,
	detail: number,
): MouseEvent<HTMLElement> {
	return { type, button, detail } as MouseEvent<HTMLElement>;
}

describe("shouldArmOnEvent (pure)", () => {
	it("arms on left click (button=0, detail>0 mouse activation)", () => {
		expect(shouldArmOnEvent({ type: "click", button: 0, detail: 1 })).toBe(
			true,
		);
	});

	it("arms on keyboard-activated click (button=0, detail=0)", () => {
		expect(shouldArmOnEvent({ type: "click", button: 0, detail: 0 })).toBe(
			true,
		);
	});

	it("does NOT arm on mousedown — canceled clicks must not arm", () => {
		expect(shouldArmOnEvent({ type: "mousedown", button: 0, detail: 1 })).toBe(
			false,
		);
	});

	it("arms on middle auxclick (button=1)", () => {
		expect(shouldArmOnEvent({ type: "auxclick", button: 1, detail: 1 })).toBe(
			true,
		);
	});

	it("does NOT arm on right auxclick (button=2)", () => {
		expect(shouldArmOnEvent({ type: "auxclick", button: 2, detail: 1 })).toBe(
			false,
		);
	});

	it("does NOT arm on contextmenu / pointerdown / other types", () => {
		expect(
			shouldArmOnEvent({ type: "contextmenu", button: 2, detail: 0 }),
		).toBe(false);
		expect(
			shouldArmOnEvent({ type: "pointerdown", button: 0, detail: 1 }),
		).toBe(false);
	});
});

describe("armReconnectOnActivation (side effects)", () => {
	beforeEach(() => {
		mockExpectLoginReturn.mockClear();
	});

	it("normal left click arms, but mousedown alone does not arm", () => {
		armReconnectOnActivation(fakeEvent("mousedown", 0, 1));
		expect(mockExpectLoginReturn).not.toHaveBeenCalled();

		armReconnectOnActivation(fakeEvent("click", 0, 1));
		expect(mockExpectLoginReturn).toHaveBeenCalledOnce();
	});

	it("middle auxclick arms", () => {
		armReconnectOnActivation(fakeEvent("auxclick", 1, 1));
		expect(mockExpectLoginReturn).toHaveBeenCalledOnce();
	});

	it("canceled mousedown path does not arm (mousedown then no click)", () => {
		armReconnectOnActivation(fakeEvent("mousedown", 0, 1));
		// User dragged out / pressed Esc — no click event ever fires.
		expect(mockExpectLoginReturn).not.toHaveBeenCalled();
	});

	it("does not arm on right click", () => {
		armReconnectOnActivation(fakeEvent("click", 2, 1));
		armReconnectOnActivation(fakeEvent("auxclick", 2, 1));
		expect(mockExpectLoginReturn).not.toHaveBeenCalled();
	});

	it("keyboard activation (Enter on focused link) arms", () => {
		armReconnectOnActivation(fakeEvent("click", 0, 0));
		expect(mockExpectLoginReturn).toHaveBeenCalledOnce();
	});
});
