import { describe, expect, it, vi } from "vitest";
import { LoginForm } from "@/features/auth/LoginForm";
import { render, screen } from "@/test/utils/render";

type Overrides = Partial<Parameters<typeof LoginForm>[0]>;

function renderForm(overrides: Overrides = {}) {
	const onSubmit = vi.fn().mockResolvedValue(undefined);
	const onGoogle = vi.fn().mockResolvedValue(undefined);
	const onModeChange = vi.fn();
	const onForgotPassword = vi.fn();
	const result = render(
		<LoginForm
			mode="signin"
			onModeChange={onModeChange}
			onSubmit={onSubmit}
			onGoogle={onGoogle}
			onForgotPassword={onForgotPassword}
			error={null}
			notice={null}
			loading={null}
			{...overrides}
		/>,
	);
	return { onSubmit, onGoogle, onModeChange, onForgotPassword, ...result };
}

describe("LoginForm", () => {
	describe("choice panel (default)", () => {
		it("shows Continue with Google and the email trigger, hides the form", () => {
			renderForm();
			expect(
				screen.getByRole("button", { name: /continue with google/i }),
			).toBeInTheDocument();
			expect(
				screen.getByRole("button", { name: /use email and password/i }),
			).toBeInTheDocument();
			expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument();
			expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
		});

		it("invokes onGoogle when Continue with Google is clicked", async () => {
			const { user, onGoogle } = renderForm();
			await user.click(
				screen.getByRole("button", { name: /continue with google/i }),
			);
			expect(onGoogle).toHaveBeenCalled();
		});

		it("expands the credentials panel when the trigger is clicked", async () => {
			const { user } = renderForm();
			await user.click(
				screen.getByRole("button", { name: /use email and password/i }),
			);
			expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
			expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
			expect(
				screen.queryByRole("button", { name: /continue with google/i }),
			).not.toBeInTheDocument();
		});

		it("hides the email trigger while Google is redirecting", () => {
			renderForm({ loading: "google" });
			expect(
				screen.getByRole("button", { name: /redirecting/i }),
			).toBeInTheDocument();
			expect(
				screen.queryByRole("button", { name: /use email and password/i }),
			).not.toBeInTheDocument();
		});

		it("auto-focuses the email field after expanding into credentials", async () => {
			const { user } = renderForm();
			await user.click(
				screen.getByRole("button", { name: /use email and password/i }),
			);
			expect(screen.getByLabelText(/email/i)).toHaveFocus();
		});

		it("auto-focuses the name field when expanding in signup mode", () => {
			renderForm({ initialPanel: "credentials", mode: "signup" });
			expect(screen.getByLabelText(/^name$/i)).toHaveFocus();
		});
	});

	describe("credentials panel", () => {
		it("submits sign-in with email + password (no name field)", async () => {
			const { user, onSubmit } = renderForm({ initialPanel: "credentials" });

			expect(screen.queryByLabelText(/^name$/i)).not.toBeInTheDocument();

			await user.type(screen.getByLabelText(/email/i), "reader@hearted.music");
			await user.type(screen.getByLabelText(/password/i), "secret1234");
			await user.click(screen.getByRole("button", { name: /^continue$/i }));

			expect(onSubmit).toHaveBeenCalledWith({
				mode: "signin",
				email: "reader@hearted.music",
				password: "secret1234",
				name: "",
			});
		});

		it("shows Name field in sign-up mode and submits all three", async () => {
			const { user, onSubmit } = renderForm({
				mode: "signup",
				initialPanel: "credentials",
			});

			await user.type(screen.getByLabelText(/^name$/i), "Reader");
			await user.type(screen.getByLabelText(/email/i), "reader@hearted.music");
			await user.type(screen.getByLabelText(/password/i), "secret1234");
			await user.click(screen.getByRole("button", { name: /create account/i }));

			expect(onSubmit).toHaveBeenCalledWith({
				mode: "signup",
				email: "reader@hearted.music",
				password: "secret1234",
				name: "Reader",
			});
		});

		it("toggles between signin and signup via the footer affordance", async () => {
			const { user, onModeChange } = renderForm({
				initialPanel: "credentials",
			});
			await user.click(
				screen.getByRole("button", { name: /create an account/i }),
			);
			expect(onModeChange).toHaveBeenCalledWith("signup");
		});

		it("shows Forgot only in sign-in mode", () => {
			const { rerender } = renderForm({ initialPanel: "credentials" });
			expect(
				screen.getByRole("button", { name: /forgot/i }),
			).toBeInTheDocument();
			rerender(
				<LoginForm
					mode="signup"
					onModeChange={() => {}}
					onSubmit={async () => {}}
					onGoogle={async () => {}}
					onForgotPassword={() => {}}
					error={null}
					notice={null}
					loading={null}
					initialPanel="credentials"
				/>,
			);
			expect(
				screen.queryByRole("button", { name: /forgot/i }),
			).not.toBeInTheDocument();
		});

		it("returns to the choice panel via 'Use Google instead'", async () => {
			const { user } = renderForm({ initialPanel: "credentials" });
			await user.click(
				screen.getByRole("button", { name: /use google instead/i }),
			);
			expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
			expect(
				screen.getByRole("button", { name: /continue with google/i }),
			).toBeInTheDocument();
		});

		it("renders error with alert role", () => {
			renderForm({
				initialPanel: "credentials",
				error: "That email and password don't match.",
			});
			expect(screen.getByRole("alert")).toHaveTextContent(/don't match/i);
		});

		it("disables every interactive control while loading", () => {
			renderForm({ initialPanel: "credentials", loading: "credentials" });
			const buttons = screen.getAllByRole("button");
			for (const btn of buttons) {
				expect(btn).toBeDisabled();
			}
		});
	});
});
