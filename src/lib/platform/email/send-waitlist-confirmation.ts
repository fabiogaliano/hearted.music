import { getPublicAppOrigin } from "@/lib/config/public-app-origin";
import { sendEmail } from "@/lib/platform/email/resend-client";

export async function sendWaitlistConfirmation(email: string) {
	return sendEmail({
		to: email,
		subject: "noted.",
		text: waitlistPlainText(),
		html: waitlistHtml(),
	});
}

function waitlistPlainText() {
	const origin = getPublicAppOrigin();
	return `You're on the waitlist.

Every song you've hearted has been waiting to be noticed. Their moment is coming!

More soon.

— ♡ ${origin}
`;
}

function waitlistHtml() {
	const origin = getPublicAppOrigin();
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
          <p style="margin:0;">— ♡ <a href="${origin}" style="color:hsl(340,20%,45%);text-decoration:none;">hearted.music</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
