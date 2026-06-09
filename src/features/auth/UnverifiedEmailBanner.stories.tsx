import type { Story } from "@ladle/react";
import { UnverifiedEmailBanner } from "@/features/auth/UnverifiedEmailBanner";

export default {
	title: "Auth/UnverifiedEmailBanner",
};

const noopAsync = async () => {};

const SlowResolve = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

export const Default: Story = () => (
	<div
		className="theme-bg theme-text"
		style={{ minHeight: "100vh", paddingTop: 0 }}
	>
		<UnverifiedEmailBanner
			email="reader@hearted.music"
			onResend={noopAsync}
			onDismiss={() => {}}
		/>
		<div style={{ padding: 32 }}>
			<p className="text-sm">App content sits below the banner.</p>
		</div>
	</div>
);

export const Resending: Story = () => (
	<div
		className="theme-bg theme-text"
		style={{ minHeight: "100vh", paddingTop: 0 }}
	>
		<UnverifiedEmailBanner
			email="reader@hearted.music"
			onResend={() => SlowResolve(5000)}
			onDismiss={() => {}}
		/>
		<div style={{ padding: 32 }}>
			<p className="text-sm">
				Click "Resend" to see the loading state (resolves after 5s).
			</p>
		</div>
	</div>
);

export const Resent: Story = () => {
	// Force the resent state by pre-resolving the promise then mounting with
	// a resolved click handler. The story simulates the post-click view.
	const Component = () => (
		<UnverifiedEmailBanner
			email="reader@hearted.music"
			onResend={async () => {}}
			onDismiss={() => {}}
		/>
	);
	return (
		<div
			className="theme-bg theme-text"
			style={{ minHeight: "100vh", paddingTop: 0 }}
		>
			<Component />
			<div style={{ padding: 32 }}>
				<p className="text-sm">
					Click "Resend" once to reach the confirmation copy.
				</p>
			</div>
		</div>
	);
};
