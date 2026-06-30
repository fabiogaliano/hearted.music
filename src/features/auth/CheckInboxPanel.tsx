import { useEffect, useState } from "react";
import {
	AuthButton,
	AuthInlineLink,
	AuthMessage,
	AuthPage,
} from "@/features/auth/AuthPage";
import { sendVerificationEmail } from "@/lib/platform/auth/auth-client";

type CheckInboxPanelProps = {
	email: string;
	onBackToSignIn: () => void;
};

type ResendState = "idle" | "sending" | "sent" | "error";

const RESEND_COOLDOWN_SECONDS = 30;

// Shown after a successful sign-up. We deliberately render no email/password
// inputs here: the account already exists, so a populated credentials form
// only invites the browser's password-manager popup and reads like a login
// screen. A confirmation with a resend action is the clearer next step.
export function CheckInboxPanel({
	email,
	onBackToSignIn,
}: CheckInboxPanelProps) {
	const [resend, setResend] = useState<ResendState>("idle");
	// Sign-up just sent the first email, so the resend starts locked — there's
	// no point firing a second send while the first is still in transit, and a
	// visible countdown is the standard way to signal the cooldown. Each resend
	// restarts the same window.
	const [secondsLeft, setSecondsLeft] = useState(RESEND_COOLDOWN_SECONDS);

	useEffect(() => {
		if (secondsLeft <= 0) return;
		const id = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
		return () => clearTimeout(id);
	}, [secondsLeft]);

	const cooling = secondsLeft > 0;

	async function handleResend() {
		if (resend === "sending" || cooling) return;
		setResend("sending");
		try {
			await sendVerificationEmail({ email, callbackURL: "/verify-email" });
			setResend("sent");
			setSecondsLeft(RESEND_COOLDOWN_SECONDS);
		} catch {
			setResend("error");
		}
	}

	return (
		<AuthPage
			headline={
				<>
					Check your <span className="italic">inbox.</span>
				</>
			}
			intro={
				<>
					We sent a verification link to{" "}
					<span className="theme-text">{email}</span>. Click it to finish
					setting up — then you're in.
				</>
			}
			footer={
				<AuthInlineLink onClick={onBackToSignIn}>
					Back to sign in
				</AuthInlineLink>
			}
		>
			<AuthButton
				onClick={handleResend}
				disabled={resend === "sending" || cooling}
				className="tabular-nums"
			>
				{resend === "sending"
					? "Sending…"
					: cooling
						? `Resend in ${secondsLeft}s`
						: "Resend link"}
			</AuthButton>

			<div className="mt-4">
				{resend === "sent" ? (
					<AuthMessage tone="info">
						Sent. If it's not in your inbox, check spam.
					</AuthMessage>
				) : resend === "error" ? (
					<AuthMessage tone="error">
						Couldn't resend just now. Try again in a moment.
					</AuthMessage>
				) : (
					<AuthMessage tone="info">
						Not in your inbox? Check spam, or resend it.
					</AuthMessage>
				)}
			</div>
		</AuthPage>
	);
}
