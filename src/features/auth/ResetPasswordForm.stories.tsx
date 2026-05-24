import type { Story } from "@ladle/react";
import { ResetPasswordForm } from "@/features/auth/ResetPasswordForm";

export default {
	title: "Email/Pass/ResetPasswordForm",
};

const noop = async () => {};

export const Idle: Story = () => (
	<ResetPasswordForm
		phase="idle"
		error={null}
		onSubmit={noop}
		onBackToLogin={() => {}}
		onRequestNew={() => {}}
	/>
);

export const Submitting: Story = () => (
	<ResetPasswordForm
		phase="submitting"
		error={null}
		onSubmit={noop}
		onBackToLogin={() => {}}
		onRequestNew={() => {}}
	/>
);

export const ValidationError: Story = () => (
	<ResetPasswordForm
		phase="idle"
		error="Password needs at least 8 characters."
		onSubmit={noop}
		onBackToLogin={() => {}}
		onRequestNew={() => {}}
	/>
);

export const TokenInvalid: Story = () => (
	<ResetPasswordForm
		phase="token-invalid"
		error={null}
		onSubmit={noop}
		onBackToLogin={() => {}}
		onRequestNew={() => {}}
	/>
);

export const Success: Story = () => (
	<ResetPasswordForm
		phase="success"
		error={null}
		onSubmit={noop}
		onBackToLogin={() => {}}
		onRequestNew={() => {}}
	/>
);
