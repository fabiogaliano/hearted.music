import { Resend } from "resend";
import { env } from "@/env";

export const EMAIL_FROM = "hearted. <hi@hearted.music>";

export type SendResult = { ok: true } | { ok: false; reason: string };

type SendArgs = {
	to: string;
	subject: string;
	html: string;
	text: string;
};

export async function sendEmail({
	to,
	subject,
	html,
	text,
}: SendArgs): Promise<SendResult> {
	if (!env.RESEND_API_KEY) {
		// Local dev: surface the message so flows are testable without Resend.
		console.info(
			`[email:dev] to=${to} subject=${JSON.stringify(subject)}\n${text}`,
		);
		return { ok: true };
	}

	const resend = new Resend(env.RESEND_API_KEY);
	const { error } = await resend.emails.send({
		from: EMAIL_FROM,
		to,
		subject,
		html,
		text,
	});
	if (error) {
		console.error("[email] resend send failed", error);
		return { ok: false, reason: error.message };
	}
	return { ok: true };
}
