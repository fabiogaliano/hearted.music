import type { Story } from "@ladle/react";
import { SetupOnComputerNotice } from "./SetupOnComputerNotice";

/**
 * The soft pre-warning shown on /login (below the CTA) and / when the current
 * browser can't run our extension. Informational only — no actions, never blocks
 * signup.
 */

export default {
	title: "Onboarding/SetupOnComputerNotice",
};

// Mock auth CTA so the note's weight reads in context, the way it does on /login:
// below the Continue-with-Google button.
function MockLogin({ children }: { children: React.ReactNode }) {
	return (
		<div className="theme-bg flex min-h-screen flex-col items-center px-6 pt-32">
			<div className="w-full max-w-[440px] space-y-6">
				<span
					className="theme-text mb-6 inline-block text-4xl leading-none font-extralight tracking-tight"
					style={{ fontFamily: "'Instrument Serif', Georgia, serif" }}
				>
					hearted.
				</span>
				<button
					type="button"
					className="theme-border-color theme-text theme-surface-bg w-full rounded-sm border px-4 py-3.5 text-xs tracking-widest uppercase"
				>
					Continue with Google
				</button>
				{children}
			</div>
		</div>
	);
}

export const BelowCTA: Story = () => (
	<MockLogin>
		<SetupOnComputerNotice />
	</MockLogin>
);
BelowCTA.meta = {
	description:
		"Quiet inline note below the login CTA — a contained bordered box. Matches the /login wiring.",
};
