/**
 * Launch welcome email via Resend.
 *
 * Sent to waitlist members when the app goes live. Branded envelope,
 * personal letter from Fábio. Skips silently if RESEND_API_KEY is not
 * set (local dev).
 */

import { Resend } from "resend";
import { env } from "@/env";

const FROM_EMAIL = "hi@hearted.music";
const FROM_NAME = "hearted.";

const SUBJECT = "your liked songs have something to tell you";

export async function sendWelcomeEmail(email: string) {
	if (!env.RESEND_API_KEY) {
		console.info("[email] RESEND_API_KEY not set, skipping welcome email");
		return;
	}

	const resend = new Resend(env.RESEND_API_KEY);

	await resend.emails.send({
		from: `${FROM_NAME} <${FROM_EMAIL}>`,
		to: email,
		subject: SUBJECT,
		text: welcomePlainText(),
		html: welcomeHtml(),
	});
}

function welcomePlainText() {
	return `When you joined the waitlist, I promised you'd be first to hear them. The stories inside your Liked Songs are ready now: https://hearted.music

Before anything else: thank you. You raised your hand for this before there was anything to show for it, and that means more than you know.

So I've left a welcome bonus on your account, already applied to the email you signed up with. It's yours at least through the end of June.

Countless late nights, a lot of learning, and it's still not perfect. So if something feels off, or something sings, tell me. Hearing from you would mean the world.

with love,
fábio galiano
hearted.

Signed up with a different email than you'll log in with? Reply and I'll make sure your bonus finds you.

hearted. is free and open source, if you ever want to look or run your own.

— ♡ https://hearted.music
`;
}

function welcomeHtml() {
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
          <p style="margin:0 0 24px;">When you joined the waitlist, I promised you'd be first to hear them. <a href="https://hearted.music" style="color:hsl(340,28%,22%);text-decoration:underline;">The stories inside your <em>Liked Songs</em> are ready now.</a></p>
          <p style="margin:0 0 24px;">Before anything else: thank you. You raised your hand for this before there was anything to show for it, and that means more than you know.</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;"><tr><td style="background:hsl(340,42%,91%);border-radius:8px;padding:18px 22px;font-size:18px;line-height:1.8;color:hsl(340,28%,22%);">So I've left a welcome bonus on your account, already applied to the email you signed up with. It's yours at least through the end of June.</td></tr></table>
          <p style="margin:0 0 24px;">Countless late nights, a lot of learning, and it's still not perfect. So if something feels off, or something sings, tell me. Hearing from you would mean the world.</p>
          <p style="margin:0;"><em>with love,</em><br/>fábio galiano<br/>hearted.</p>
        </td></tr>
        <tr><td style="padding-top:24px;border-top:1px solid hsl(340,20%,75%);font-size:13px;color:hsl(340,20%,45%);">
          <p style="margin:0 0 12px;">Signed up with a different email than you'll log in with? Reply and I'll make sure your bonus finds you.</p>
          <p style="margin:0 0 12px;">hearted. is free and open source, if you ever want to look or run your own.</p>
          <p style="margin:0;">— ♡ <a href="https://hearted.music" style="color:hsl(340,20%,45%);text-decoration:none;">hearted.music</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
