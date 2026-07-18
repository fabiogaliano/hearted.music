/**
 * IntentEditor gating logic tests.
 *
 * Verifies the two core eligibility branches:
 *   - Eligible: textarea is rendered, onChange fires, no CTA rendered.
 *   - Ineligible: a single collapsed field-shaped teaser (no textarea at
 *     all — a button showing a muted example phrase and the "Backstage
 *     Pass" chip) that triggers the paywall, carries the premium note via
 *     aria-describedby, and never lets onChange fire.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IntentEditor } from "../config/IntentEditor";

afterEach(cleanup);

describe("IntentEditor — eligible", () => {
	it("renders a textarea for input", () => {
		render(
			<IntentEditor
				isEligible={true}
				value={undefined}
				onChange={vi.fn()}
				onOpenPaywall={vi.fn()}
			/>,
		);
		expect(
			screen.getByRole("textbox", { name: /playlist intent/i }),
		).toBeTruthy();
	});

	it("calls onChange with the typed value", () => {
		const onChange = vi.fn();
		render(
			<IntentEditor
				isEligible={true}
				value={undefined}
				onChange={onChange}
				onOpenPaywall={vi.fn()}
			/>,
		);
		const textarea = screen.getByRole("textbox", { name: /playlist intent/i });
		fireEvent.change(textarea, { target: { value: "late night drive" } });
		expect(onChange).toHaveBeenCalledWith("late night drive");
	});

	it("calls onChange with undefined when input is cleared", () => {
		const onChange = vi.fn();
		render(
			<IntentEditor
				isEligible={true}
				value="some intent"
				onChange={onChange}
				onOpenPaywall={vi.fn()}
			/>,
		);
		const textarea = screen.getByRole("textbox", { name: /playlist intent/i });
		fireEvent.change(textarea, { target: { value: "" } });
		expect(onChange).toHaveBeenCalledWith(undefined);
	});

	it("does not render the paywall CTA", () => {
		render(
			<IntentEditor
				isEligible={true}
				value={undefined}
				onChange={vi.fn()}
				onOpenPaywall={vi.fn()}
			/>,
		);
		expect(
			screen.queryByRole("button", { name: /backstage pass/i }),
		).toBeNull();
	});
});

describe("IntentEditor — ineligible", () => {
	it("renders no textarea — the locked teaser is a button, so intent can't be typed", () => {
		render(
			<IntentEditor
				isEligible={false}
				value={undefined}
				onChange={vi.fn()}
				onOpenPaywall={vi.fn()}
			/>,
		);
		expect(document.querySelector("textarea")).toBeNull();
		expect(
			screen.getByRole("button", { name: /late-night drive/i }),
		).toBeTruthy();
	});

	it("the locked trigger carries aria-describedby pointing to the premium note", () => {
		render(
			<IntentEditor
				isEligible={false}
				value={undefined}
				onChange={vi.fn()}
				onOpenPaywall={vi.fn()}
			/>,
		);
		const buttons = screen.getAllByRole("button");
		expect(buttons).toHaveLength(1);
		for (const button of buttons) {
			const descId = button.getAttribute("aria-describedby");
			expect(descId).toBeTruthy();
			const descEl = descId ? document.getElementById(descId) : null;
			expect(descEl?.textContent).toMatch(/backstage pass/i);
		}
	});

	it("renders the Backstage Pass chip on the teaser button", () => {
		render(
			<IntentEditor
				isEligible={false}
				value={undefined}
				onChange={vi.fn()}
				onOpenPaywall={vi.fn()}
			/>,
		);
		expect(
			screen.getByRole("button", { name: /backstage pass/i }),
		).toBeTruthy();
	});

	it("calls onOpenPaywall from the teaser field", () => {
		const onOpenPaywall = vi.fn();
		render(
			<IntentEditor
				isEligible={false}
				value={undefined}
				onChange={vi.fn()}
				onOpenPaywall={onOpenPaywall}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: /late-night drive/i }));
		expect(onOpenPaywall).toHaveBeenCalledOnce();
	});

	it("never calls onChange — intent cannot leak from the locked state", () => {
		const onChange = vi.fn();
		const onOpenPaywall = vi.fn();
		render(
			<IntentEditor
				isEligible={false}
				value={undefined}
				onChange={onChange}
				onOpenPaywall={onOpenPaywall}
			/>,
		);
		// Clicking the locked triggers opens the paywall, never sets intent.
		for (const button of screen.getAllByRole("button")) {
			fireEvent.click(button);
		}
		expect(onChange).not.toHaveBeenCalled();
	});

	it("renders a visible teaser phrase (not hidden/blurred)", () => {
		render(
			<IntentEditor
				isEligible={false}
				value={undefined}
				onChange={vi.fn()}
				onOpenPaywall={vi.fn()}
			/>,
		);
		// The locked field shows a muted example phrase as plain text — visible
		// and readable, just not interactive as an input.
		expect(
			screen.getByText("Late-night drive through an empty city"),
		).toBeTruthy();
	});
});
