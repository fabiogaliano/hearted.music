/**
 * IntentEditor gating logic tests.
 *
 * Verifies the two core eligibility branches:
 *   - Eligible: textarea is rendered, onChange fires, no CTA rendered.
 *   - Ineligible: teaser is visible, onChange is never called, CTA present.
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
	it("does not render an editable textarea — the teaser is disabled", () => {
		render(
			<IntentEditor
				isEligible={false}
				value={undefined}
				onChange={vi.fn()}
				onOpenPaywall={vi.fn()}
			/>,
		);
		// The locked teaser is a real <textarea disabled> so screen readers can
		// reach it — but it must not be editable (keyboard input goes nowhere).
		const textarea = document.querySelector<HTMLTextAreaElement>("textarea");
		expect(textarea).not.toBeNull();
		expect(textarea?.disabled).toBe(true);
	});

	it("renders the locked teaser with aria-describedby pointing to the premium note", () => {
		render(
			<IntentEditor
				isEligible={false}
				value={undefined}
				onChange={vi.fn()}
				onOpenPaywall={vi.fn()}
			/>,
		);
		const textarea = document.querySelector<HTMLTextAreaElement>("textarea");
		const descId = textarea?.getAttribute("aria-describedby");
		expect(descId).toBeTruthy();
		const descEl = descId ? document.getElementById(descId) : null;
		expect(descEl?.textContent).toMatch(/backstage pass/i);
	});

	it("renders the upgrade CTA button", () => {
		render(
			<IntentEditor
				isEligible={false}
				value={undefined}
				onChange={vi.fn()}
				onOpenPaywall={vi.fn()}
			/>,
		);
		expect(screen.getByRole("button")).toBeTruthy();
	});

	it("calls onOpenPaywall when the CTA is clicked", () => {
		const onOpenPaywall = vi.fn();
		render(
			<IntentEditor
				isEligible={false}
				value={undefined}
				onChange={vi.fn()}
				onOpenPaywall={onOpenPaywall}
			/>,
		);
		fireEvent.click(screen.getByRole("button"));
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
		// Clicking the CTA should open the paywall, not set intent.
		fireEvent.click(screen.getByRole("button"));
		expect(onChange).not.toHaveBeenCalled();
	});

	it("renders a visible teaser phrase in the disabled textarea (not hidden/blurred)", () => {
		render(
			<IntentEditor
				isEligible={false}
				value={undefined}
				onChange={vi.fn()}
				onOpenPaywall={vi.fn()}
			/>,
		);
		// The locked state shows a muted example phrase via the disabled textarea's
		// value — visible and readable but not interactive.
		const textarea = document.querySelector<HTMLTextAreaElement>("textarea");
		expect(textarea?.value).toBe("Late-night drive through an empty city");
	});
});
