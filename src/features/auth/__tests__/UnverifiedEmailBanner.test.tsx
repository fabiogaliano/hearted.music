import { describe, expect, it, vi } from "vitest";
import { UnverifiedEmailBanner } from "@/features/auth/UnverifiedEmailBanner";
import { render, screen } from "@/test/utils/render";

describe("UnverifiedEmailBanner", () => {
	it("invokes onDismiss when Dismiss is clicked", async () => {
		const onDismiss = vi.fn();
		const { user } = render(
			<UnverifiedEmailBanner
				email="reader@hearted.music"
				onResend={async () => {}}
				onDismiss={onDismiss}
			/>,
		);
		await user.click(screen.getByRole("button", { name: /dismiss/i }));
		expect(onDismiss).toHaveBeenCalledTimes(1);
	});

	it("swaps Resend for confirmation copy after a successful resend", async () => {
		const onResend = vi.fn().mockResolvedValue(undefined);
		const { user } = render(
			<UnverifiedEmailBanner
				email="reader@hearted.music"
				onResend={onResend}
				onDismiss={() => {}}
			/>,
		);
		await user.click(screen.getByRole("button", { name: /^resend$/i }));
		expect(onResend).toHaveBeenCalled();
		expect(screen.getByText(/we sent a fresh link/i)).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: /^resend$/i }),
		).not.toBeInTheDocument();
	});
});
