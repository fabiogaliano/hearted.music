import { sendEmail } from "@/lib/platform/email/resend-client";
import { envelopeHtml } from "@/lib/platform/email/templates";

type Args = {
	to: string;
	resetUrl: string;
};

export async function sendPasswordResetEmail({ to, resetUrl }: Args) {
	const subject = "reset your password";

	const html = envelopeHtml({
		preheader: "Pick a new password to get back into your library.",
		headline: "Let's get you back in.",
		bodyHtml: `
			<p style="margin:0 0 16px;">Click the link below to choose a new password. It works once, and it expires soon.</p>
			<p style="margin:0;">If you didn't ask for this, you can ignore the email. Your current password stays the same.</p>
		`,
		ctaLabel: "Reset password",
		ctaUrl: resetUrl,
		footnote:
			"For your safety, every other signed-in session will sign out after you reset.",
	});

	const text = `Let's get you back in.

Click the link below to choose a new password. It works once, and it expires soon:

${resetUrl}

If you didn't ask for this, ignore the email — your current password stays the same.

For your safety, every other signed-in session will sign out after you reset.

— ♡ hearted.music
`;

	return sendEmail({ to, subject, html, text });
}
