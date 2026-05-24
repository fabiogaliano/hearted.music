import type { Story } from "@ladle/react";
import { VerifyEmailPanel } from "@/features/auth/VerifyEmailPanel";

export default {
	title: "Email/Pass/VerifyEmailPanel",
};

const noop = async () => {};

export const Success: Story = () => (
	<VerifyEmailPanel
		phase="success"
		errorMessage={null}
		onContinue={() => {}}
		onResend={noop}
	/>
);

export const Expired: Story = () => (
	<VerifyEmailPanel
		phase="expired"
		errorMessage={null}
		onContinue={() => {}}
		onResend={noop}
	/>
);

export const GenericError: Story = () => (
	<VerifyEmailPanel
		phase="error"
		errorMessage="The verification token couldn't be validated."
		onContinue={() => {}}
		onResend={noop}
	/>
);
