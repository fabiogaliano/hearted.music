import { sendEmail } from "@/lib/platform/email/resend-client";
import { envelopeHtml } from "@/lib/platform/email/templates";

type Args = {
	to: string;
	verifyUrl: string;
};

export async function sendVerificationEmail({ to, verifyUrl }: Args) {
	const subject = "verify your email";

	const html = envelopeHtml({
		preheader: "Confirm this email so your songs find their way to you.",
		headline: "One step left.",
		bodyHtml: `
			<p style="margin:0 0 16px;">Confirm this email so your songs can find their way to you.</p>
			<p style="margin:0;">The link expires soon. If you didn't ask for it, you can ignore this message.</p>
		`,
		ctaLabel: "Verify email",
		ctaUrl: verifyUrl,
		footnote: "— ♡ hearted.music",
	});

	const text = `One step left.

Confirm this email so your songs can find their way to you:

${verifyUrl}

If you didn't ask for it, ignore this message.

— ♡ hearted.music
`;

	return sendEmail({ to, subject, html, text });
}
