// Shared HTML envelope for transactional emails.
// Editorial aesthetic: Instrument-Serif-feeling display via system serif fallback
// (custom fonts don't reliably load in email clients), warm rose surface, single
// well-spaced CTA, square corners.

type EnvelopeArgs = {
	preheader: string;
	headline: string;
	bodyHtml: string;
	ctaLabel: string;
	ctaUrl: string;
	footnote?: string;
};

export function envelopeHtml({
	preheader,
	headline,
	bodyHtml,
	ctaLabel,
	ctaUrl,
	footnote,
}: EnvelopeArgs) {
	return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:hsl(340,32%,92%);font-family:Georgia,'Times New Roman',serif;">
  <span style="display:none;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${escapeHtml(preheader)}</span>
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:48px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;">
        <tr><td style="padding-bottom:40px;">
          <span style="font-size:22px;font-weight:200;letter-spacing:-0.5px;color:hsl(340,28%,22%);">hearted.</span>
        </td></tr>
        <tr><td style="padding-bottom:24px;">
          <h1 style="margin:0;font-style:italic;font-weight:300;font-size:32px;line-height:1.15;letter-spacing:-0.01em;color:hsl(340,28%,22%);">${escapeHtml(headline)}</h1>
        </td></tr>
        <tr><td style="font-size:16px;line-height:1.7;color:hsl(340,28%,28%);font-family:Helvetica,Arial,sans-serif;">
          ${bodyHtml}
        </td></tr>
        <tr><td style="padding:32px 0 8px;">
          <a href="${ctaUrl}" style="display:inline-block;background:hsl(340,28%,22%);color:hsl(340,32%,92%);text-decoration:none;padding:14px 28px;font-family:Helvetica,Arial,sans-serif;font-size:13px;font-weight:500;letter-spacing:0.18em;text-transform:uppercase;">${escapeHtml(ctaLabel)}</a>
        </td></tr>
        <tr><td style="padding-top:8px;font-size:12px;color:hsl(340,20%,42%);font-family:Helvetica,Arial,sans-serif;line-height:1.6;word-break:break-all;">
          Or paste this link into your browser:<br />
          <a href="${ctaUrl}" style="color:hsl(340,20%,42%);text-decoration:underline;">${escapeHtml(ctaUrl)}</a>
        </td></tr>
        ${
					footnote
						? `<tr><td style="padding-top:32px;border-top:1px solid hsl(340,20%,78%);font-size:12px;color:hsl(340,20%,42%);font-family:Helvetica,Arial,sans-serif;line-height:1.6;">
          ${footnote}
        </td></tr>`
						: ""
				}
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function escapeHtml(value: string) {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}
