import type { Story } from "@ladle/react";
import { envelopeHtml } from "@/lib/platform/email/templates";

export default {
	title: "Email/Templates",
};

const SAMPLE_VERIFY_URL =
	"https://hearted.music/api/auth/verify-email?token=sample-token-value&callbackURL=/onboarding";

// Renders the real envelopeHtml output — the same string Resend sends — inside
// an iframe so the email's own <html>/<body> styles are isolated from Ladle's
// page styles (email clients render in their own document; an iframe mirrors
// that). Inline styles are the only thing that survives in email, which is why
// templates.ts hardcodes every color and font.
function EmailFrame({ html }: { html: string }) {
	return (
		<iframe
			title="Email preview"
			srcDoc={html}
			style={{ width: "100%", height: "100vh", border: "none" }}
		/>
	);
}

export const VerifyEmail: Story = () => (
	<EmailFrame
		html={envelopeHtml({
			preheader: "Confirm this email so your songs find their way to you.",
			headline: "One step left.",
			bodyHtml: `
				<p style="margin:0 0 16px;">Confirm this email so your songs can find their way to you.</p>
				<p style="margin:0;">The link expires soon. If you didn't ask for it, you can ignore this message.</p>
			`,
			ctaLabel: "Verify email",
			ctaUrl: SAMPLE_VERIFY_URL,
			footnote: "— ♡ hearted.music",
		})}
	/>
);
