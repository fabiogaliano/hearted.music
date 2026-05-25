import type { Story } from "@ladle/react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import {
	ConsentContext,
	type ConsentContextValue,
} from "@/lib/consent/consent-context";
import type { ConsentStatus } from "@/lib/consent/consent-storage";
import { fonts } from "@/lib/theme/fonts";
import { ConsentBanner } from "./ConsentBanner";

export default {
	title: "Consent/ConsentBanner",
};

// Drives the banner through a controlled context rather than the real
// ConsentProvider, so the story never imports the PostHog/Sentry wiring (which
// pulls @tanstack/react-start, unusable in Ladle's plain-Vite browser build).
// grant/deny hide it and record a decision; "Show banner again" re-opens it.
export const Default: Story = () => {
	const [status, setStatus] = useState<ConsentStatus | null>(null);
	const [showBanner, setShowBanner] = useState(true);

	const value: ConsentContextValue = {
		status,
		showBanner,
		isUpdating: false,
		grant: () => {
			setStatus("granted");
			setShowBanner(false);
		},
		deny: () => {
			setStatus("denied");
			setShowBanner(false);
		},
		reopen: () => setShowBanner(true),
	};

	return (
		<ConsentContext.Provider value={value}>
			<div className="mx-auto max-w-5xl px-8 py-16">
				<p
					className="theme-text text-3xl font-extralight"
					style={{ fontFamily: fonts.display }}
				>
					the stories inside your <em>liked songs</em>
				</p>
				<p
					className="theme-text-muted mt-6 max-w-md text-sm leading-relaxed"
					style={{ fontFamily: fonts.body }}
				>
					Faux page content so the prompt reads as the blocking modal overlay it
					is in production. Accept or Decline to dismiss it, then re-open.
				</p>

				<div className="mt-10 flex items-center gap-4">
					<Button variant="secondary" size="sm" onClick={value.reopen}>
						Show banner again
					</Button>
					<span
						className="theme-text-muted text-xs tracking-widest uppercase"
						style={{ fontFamily: fonts.body }}
					>
						stored decision: {status ?? "none"} · visible:{" "}
						{showBanner ? "yes" : "no"}
					</span>
				</div>
			</div>

			<ConsentBanner />
		</ConsentContext.Provider>
	);
};
