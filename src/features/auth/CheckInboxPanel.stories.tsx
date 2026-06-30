import type { Story } from "@ladle/react";
import { CheckInboxPanel } from "@/features/auth/CheckInboxPanel";

export default {
	title: "Auth/CheckInboxPanel",
};

export const Default: Story = () => (
	<CheckInboxPanel email="okkgg9@gmail.com" onBackToSignIn={() => {}} />
);

export const LongEmail: Story = () => (
	<CheckInboxPanel
		email="someone.with.a.very.long.address@subdomain.example.com"
		onBackToSignIn={() => {}}
	/>
);
