import { useState } from "react";
import {
	AuthButton,
	AuthField,
	AuthInlineLink,
	AuthMessage,
	AuthPage,
} from "@/features/auth/AuthPage";

export type ForgotPasswordPhase = "idle" | "submitting" | "submitted" | "error";

type ForgotPasswordFormProps = {
	phase: ForgotPasswordPhase;
	error: string | null;
	onSubmit: (email: string) => Promise<void> | void;
	onBackToLogin: () => void;
};

export function ForgotPasswordForm({
	phase,
	error,
	onSubmit,
	onBackToLogin,
}: ForgotPasswordFormProps) {
	const [email, setEmail] = useState("");
	const isBusy = phase === "submitting";

	if (phase === "submitted") {
		return (
			<AuthPage
				headline={
					<>
						Check your <span className="italic">inbox.</span>
					</>
				}
				intro="If we have an account for that email, a reset link is on its way."
				footer={
					<AuthInlineLink onClick={onBackToLogin}>
						Back to sign in
					</AuthInlineLink>
				}
			>
				<p className="theme-text-muted text-sm">
					The link expires in an hour. If nothing arrives in a few minutes,
					check your spam folder.
				</p>
			</AuthPage>
		);
	}

	return (
		<AuthPage
			headline={
				<>
					Lost the <span className="italic">password?</span>
				</>
			}
			intro="Tell us your email. We'll send you a link to set a new one."
			footer={
				<>
					Changed your mind?{" "}
					<AuthInlineLink onClick={onBackToLogin}>
						Back to sign in
					</AuthInlineLink>
				</>
			}
		>
			<form
				className="space-y-4"
				onSubmit={async (e) => {
					e.preventDefault();
					await onSubmit(email);
				}}
			>
				<AuthField
					label="Email"
					htmlFor="email"
					type="email"
					value={email}
					onChange={setEmail}
					autoComplete="email"
					required
					disabled={isBusy}
				/>
				{error && <AuthMessage tone="error">{error}</AuthMessage>}
				<AuthButton type="submit" disabled={isBusy}>
					{isBusy ? "Sending…" : "Send reset link"}
				</AuthButton>
			</form>
		</AuthPage>
	);
}
