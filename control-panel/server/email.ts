/**
 * Compose + send transactional email in Hearted's house style, from the panel.
 *
 * The visual style is the product's own `envelopeHtml` (rose surface, italic
 * serif headline, single uppercase CTA) — we relative-import that pure template
 * so the panel sends the EXACT same markup as the app's verify/reset flows,
 * never a drifting copy. It's safe to reach across the src/ boundary here (which
 * the panel otherwise avoids) precisely because templates.ts imports nothing: no
 * `@/env`, no DB client, so it can't split reads between prod and the local db.
 */

import { Resend } from "resend";
import { envelopeHtml } from "../../src/lib/platform/email/templates";
import { getResendApiKey } from "./prod-creds";

// Mirrors EMAIL_FROM in src/lib/platform/email/resend-client.ts (kept in sync by
// hand — it's a single constant, and importing resend-client would drag @/env).
const EMAIL_FROM = "hearted. <hi@hearted.music>";
const DEFAULT_FOOTNOTE = "— ♡ hearted.music";

export interface StyledEmailInput {
	to?: string;
	subject?: string;
	headline?: string;
	body?: string;
	ctaLabel?: string;
	ctaUrl?: string;
	preheader?: string;
	footnote?: string;
}

export interface RenderedEmail {
	from: string;
	to: string;
	subject: string;
	html: string;
	text: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

// Blank-line-separated blocks become paragraphs; single newlines become <br>.
// We escape every block so an operator types plain prose, never raw HTML — the
// only link in the envelope is the CTA, which the template renders itself.
function paragraphsToHtml(body: string): string {
	const blocks = body
		.trim()
		.split(/\n\s*\n/)
		.map((b) => b.trim())
		.filter(Boolean);
	return blocks
		.map((block, i) => {
			const inner = escapeHtml(block).replace(/\n/g, "<br />");
			const margin = i === blocks.length - 1 ? "0" : "0 0 16px";
			return `<p style="margin:${margin};">${inner}</p>`;
		})
		.join("\n");
}

interface EnvelopeFields {
	subject: string;
	headline: string;
	body: string;
	ctaLabel: string;
	ctaUrl: string;
	preheader: string;
	footnote: string;
}

function buildHtmlAndText(f: EnvelopeFields): { html: string; text: string } {
	const html = envelopeHtml({
		preheader: f.preheader || f.subject,
		headline: f.headline,
		bodyHtml: paragraphsToHtml(f.body),
		ctaLabel: f.ctaLabel,
		ctaUrl: f.ctaUrl,
		footnote: f.footnote,
	});

	const text = `${f.headline}

${f.body.trim()}

${f.ctaLabel}: ${f.ctaUrl}

${f.footnote}
`;

	return { html, text };
}

/** Validate + normalize the form input into the exact strings Resend receives. */
export function renderStyledEmail(input: StyledEmailInput): RenderedEmail {
	const to = (input.to ?? "").trim();
	const subject = (input.subject ?? "").trim();
	const headline = (input.headline ?? "").trim();
	const body = (input.body ?? "").trim();
	const ctaLabel = (input.ctaLabel ?? "").trim();
	const ctaUrl = (input.ctaUrl ?? "").trim();
	const preheader = (input.preheader ?? "").trim();
	const footnote = (input.footnote ?? "").trim() || DEFAULT_FOOTNOTE;

	if (!EMAIL_RE.test(to)) throw new Error(`"${to}" is not a valid email.`);
	if (!subject) throw new Error("Subject is required.");
	if (!headline) throw new Error("Headline is required.");
	if (!body) throw new Error("Body is required.");
	if (!ctaLabel || !ctaUrl) {
		throw new Error("Both button label and button URL are required.");
	}
	if (!/^https?:\/\//.test(ctaUrl)) {
		throw new Error("Button URL must start with http:// or https://.");
	}

	const { html, text } = buildHtmlAndText({
		subject,
		headline,
		body,
		ctaLabel,
		ctaUrl,
		preheader,
		footnote,
	});
	return { from: EMAIL_FROM, to, subject, html, text };
}

/**
 * Lenient render for the live composer preview: never throws on half-typed
 * input — empty fields fall back to ghost placeholders so the envelope always
 * renders something to look at while the operator writes.
 */
export function previewStyledEmail(input: StyledEmailInput): {
	html: string;
	text: string;
} {
	return buildHtmlAndText({
		subject: (input.subject ?? "").trim() || "Subject line",
		headline: (input.headline ?? "").trim() || "Your headline",
		body:
			(input.body ?? "").trim() ||
			"Your message appears here.\n\nUse a blank line to start a new paragraph.",
		ctaLabel: (input.ctaLabel ?? "").trim() || "Button",
		ctaUrl: (input.ctaUrl ?? "").trim() || "https://hearted.music",
		preheader: (input.preheader ?? "").trim(),
		footnote: (input.footnote ?? "").trim() || DEFAULT_FOOTNOTE,
	});
}

export interface SentEmail {
	id: string | null;
}

export async function sendStyledEmail(email: RenderedEmail): Promise<SentEmail> {
	const resend = new Resend(getResendApiKey());
	const { data, error } = await resend.emails.send({
		from: email.from,
		to: email.to,
		subject: email.subject,
		html: email.html,
		text: email.text,
	});
	if (error) throw new Error(`Resend send failed: ${error.message}`);
	return { id: data?.id ?? null };
}
