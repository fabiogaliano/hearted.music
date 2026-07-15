// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { isModalOpen } from "../../lib/modal-open";
import { ConfirmModal } from "../ConfirmModal";

describe("ConfirmModal", () => {
	it("exposes an accessible title and description via aria attributes", () => {
		render(
			<ConfirmModal
				title="Commit to production"
				description="This is a real write."
				onConfirm={async () => {}}
				onClose={vi.fn()}
			/>,
		);
		const dialog = screen.getByRole("alertdialog");
		const labelId = dialog.getAttribute("aria-labelledby");
		const descId = dialog.getAttribute("aria-describedby");
		expect(document.getElementById(labelId ?? "")?.textContent).toBe(
			"Commit to production",
		);
		expect(document.getElementById(descId ?? "")?.textContent).toBe(
			"This is a real write.",
		);
	});

	it("keeps confirm disabled until a required reason is entered", () => {
		const onConfirm = vi.fn(async () => {});
		render(
			<ConfirmModal
				title="Reject"
				description="Destructive."
				requireReason
				onConfirm={onConfirm}
				onClose={vi.fn()}
			/>,
		);
		const confirm = screen.getByRole("button", {
			name: "Confirm",
		}) as HTMLButtonElement;
		expect(confirm.disabled).toBe(true);
		fireEvent.change(screen.getByLabelText(/Reason/), {
			target: { value: "wrong match" },
		});
		expect(confirm.disabled).toBe(false);
		fireEvent.click(confirm);
		expect(onConfirm).toHaveBeenCalledWith("wrong match");
	});

	it("closes on Escape before submission", () => {
		const onClose = vi.fn();
		render(
			<ConfirmModal
				title="Commit"
				description="x"
				onConfirm={async () => {}}
				onClose={onClose}
			/>,
		);
		fireEvent.keyDown(window, { key: "Escape" });
		expect(onClose).toHaveBeenCalled();
	});

	it("stays open and surfaces the error when confirm rejects", async () => {
		const onClose = vi.fn();
		render(
			<ConfirmModal
				title="Commit"
				description="x"
				onConfirm={async () => {
					throw new Error("stale preview");
				}}
				onClose={onClose}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
		expect(await screen.findByText("stale preview")).toBeTruthy();
		expect(onClose).not.toHaveBeenCalled();
	});

	it("registers an open-modal signal only while mounted", async () => {
		const { unmount } = render(
			<ConfirmModal
				title="Commit"
				description="x"
				onConfirm={async () => {}}
				onClose={vi.fn()}
			/>,
		);
		expect(isModalOpen()).toBe(true);
		unmount();
		await waitFor(() => expect(isModalOpen()).toBe(false));
	});
});
