import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockExpectLoginReturn } = vi.hoisted(() => {
	const mockExpectLoginReturn = vi.fn().mockResolvedValue(true);
	return { mockExpectLoginReturn };
});

vi.mock("../detect", () => ({
	expectLoginReturn: () => mockExpectLoginReturn(),
}));

import type { MouseEvent } from "react";
import { armReconnectOnActivation } from "../reconnect-link";

function fakeEvent(
	type: string,
	button: number,
	detail: number,
): MouseEvent<HTMLElement> {
	return { type, button, detail } as MouseEvent<HTMLElement>;
}

describe("armReconnectOnActivation", () => {
	beforeEach(() => {
		mockExpectLoginReturn.mockClear();
	});

	it("arms on left mousedown (button=0)", () => {
		armReconnectOnActivation(fakeEvent("mousedown", 0, 0));
		expect(mockExpectLoginReturn).toHaveBeenCalledOnce();
	});

	it("does not arm on right mousedown (button=2)", () => {
		armReconnectOnActivation(fakeEvent("mousedown", 2, 0));
		expect(mockExpectLoginReturn).not.toHaveBeenCalled();
	});

	it("does not arm on middle mousedown (button=1)", () => {
		armReconnectOnActivation(fakeEvent("mousedown", 1, 0));
		expect(mockExpectLoginReturn).not.toHaveBeenCalled();
	});

	it("arms on middle auxclick (button=1)", () => {
		armReconnectOnActivation(fakeEvent("auxclick", 1, 0));
		expect(mockExpectLoginReturn).toHaveBeenCalledOnce();
	});

	it("does not arm on right auxclick (button=2)", () => {
		armReconnectOnActivation(fakeEvent("auxclick", 2, 0));
		expect(mockExpectLoginReturn).not.toHaveBeenCalled();
	});

	it("arms on keyboard-activated click (detail=0)", () => {
		armReconnectOnActivation(fakeEvent("click", 0, 0));
		expect(mockExpectLoginReturn).toHaveBeenCalledOnce();
	});

	it("does not arm on mouse-driven click (detail>0) — covered by mousedown", () => {
		armReconnectOnActivation(fakeEvent("click", 0, 1));
		expect(mockExpectLoginReturn).not.toHaveBeenCalled();
	});
});
