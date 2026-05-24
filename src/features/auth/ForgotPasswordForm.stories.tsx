import type { Story } from "@ladle/react";
import { ForgotPasswordForm } from "@/features/auth/ForgotPasswordForm";

export default {
	title: "Email/Pass/ForgotPasswordForm",
};

const noop = async () => {};

export const Idle: Story = () => (
	<ForgotPasswordForm
		phase="idle"
		error={null}
		onSubmit={noop}
		onBackToLogin={() => {}}
	/>
);

export const Submitting: Story = () => (
	<ForgotPasswordForm
		phase="submitting"
		error={null}
		onSubmit={noop}
		onBackToLogin={() => {}}
	/>
);

export const Submitted: Story = () => (
	<ForgotPasswordForm
		phase="submitted"
		error={null}
		onSubmit={noop}
		onBackToLogin={() => {}}
	/>
);

export const ServerError: Story = () => (
	<ForgotPasswordForm
		phase="error"
		error="Something went sideways. Try again in a moment."
		onSubmit={noop}
		onBackToLogin={() => {}}
	/>
);
