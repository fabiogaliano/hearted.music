/**
 * Waitlist confirmation email via Resend.
 *
 * Skips silently if RESEND_API_KEY is not set (local dev).
 */

import { Resend } from "resend";
import { env } from "@/env";

const FROM_EMAIL = "hi@hearted.music";
const FROM_NAME = "hearted.";

export async function sendWaitlistConfirmation(email: string) {
	if (!env.RESEND_API_KEY) {
		console.info("[email] RESEND_API_KEY not set, skipping confirmation email");
		return;
	}

	const resend = new Resend(env.RESEND_API_KEY);

	await resend.emails.send({
		from: `${FROM_NAME} <${FROM_EMAIL}>`,
		to: email,
		subject: "noted.",
		text: waitlistPlainText(),
		html: waitlistHtml(),
	});
}

function waitlistPlainText() {
	return `You're on the waitlist.

Every song you've hearted has been waiting to be noticed. Their moment is coming!

More soon.

— ♡ https://hearted.music
`;
}

function waitlistHtml() {
	return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:hsl(340,32%,85%);font-family:Georgia,'Times New Roman',serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;">
        <tr><td style="padding-bottom:40px;">
          <span style="font-size:24px;font-weight:200;letter-spacing:-0.5px;color:hsl(340,28%,22%);">hearted.</span>
        </td></tr>
        <tr><td style="font-size:18px;line-height:1.8;color:hsl(340,28%,22%);">
          <p style="margin:0 0 24px;">You're on the waitlist.</p>
          <p style="margin:0 0 24px;">Every song you've hearted has been waiting to be noticed. Their moment is coming!</p>
          <p style="margin:0 0 32px;color:hsl(340,20%,45%);font-style:italic;font-size:16px;">More soon.</p>
        </td></tr>
        <tr><td style="padding-top:24px;border-top:1px solid hsl(340,20%,75%);font-size:13px;color:hsl(340,20%,45%);">
          <p style="margin:0;">— ♡ hearted. · <a href="https://hearted.music" style="color:hsl(340,20%,45%);text-decoration:none;">hearted.music</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
