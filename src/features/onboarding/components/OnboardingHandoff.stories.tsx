import type { Story } from "@ladle/react";
import { OnboardingHandoff } from "./OnboardingHandoff";

/**
 * The install-extension step's handoff, reached when the current device can't
 * run the extension here — incompatible browser (Safari / iOS) or a capable
 * browser on too small a screen. One message either way: finish on a computer.
 */

export default {
	title: "Onboarding/OnboardingHandoff",
};

// Mirrors StepContainer's non-fullBleed centering so the handoff reads like the
// page it replaces inside the install-extension step.
function Centered({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex min-h-screen items-center justify-center px-6">
			<div className="w-full max-w-2xl">{children}</div>
		</div>
	);
}

export const Default: Story = () => (
	<Centered>
		<OnboardingHandoff />
	</Centered>
);
Default.meta = {
	description:
		"Shown when the current device can't run the extension — incompatible browser (Safari / iOS) or a capable browser on too small a screen. One message either way: finish on a computer.",
};
