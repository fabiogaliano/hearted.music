import { useState } from "react";
import {
	AuthButton,
	AuthField,
	AuthInlineLink,
	AuthMessage,
	AuthPage,
} from "@/features/auth/AuthPage";

export type ResetPasswordPhase =
	| "idle"
	| "submitting"
	| "success"
	| "token-invalid";

type ResetPasswordFormProps = {
	phase: ResetPasswordPhase;
	error: string | null;
	onSubmit: (newPassword: string) => Promise<void> | void;
	onBackToLogin: () => void;
	onRequestNew: () => void;
};

export function ResetPasswordForm({
	phase,
	error,
	onSubmit,
	onBackToLogin,
	onRequestNew,
}: ResetPasswordFormProps) {
	const [password, setPassword] = useState("");

	if (phase === "token-invalid") {
		return (
			<AuthPage
				headline={
					<>
						Link no longer <span className="italic">works.</span>
					</>
				}
				intro="Reset links are single-use and expire within an hour."
				footer={
					<AuthInlineLink onClick={onBackToLogin}>
						Back to sign in
					</AuthInlineLink>
				}
			>
				<AuthButton onClick={onRequestNew}>Request a new link</AuthButton>
			</AuthPage>
		);
	}

	if (phase === "success") {
		return (
			<AuthPage
				headline={
					<>
						Password <span className="italic">updated.</span>
					</>
				}
				intro="We've signed every other session out, just to be safe."
			>
				<AuthButton onClick={onBackToLogin}>Sign in</AuthButton>
			</AuthPage>
		);
	}

	const isBusy = phase === "submitting";

	return (
		<AuthPage
			headline={
				<>
					Choose a <span className="italic">new password.</span>
				</>
			}
			intro="At least 8 characters. Make it something you can remember."
		>
			<form
				className="space-y-4"
				onSubmit={async (e) => {
					e.preventDefault();
					await onSubmit(password);
				}}
			>
				<AuthField
					label="New password"
					htmlFor="new-password"
					type="password"
					value={password}
					onChange={setPassword}
					autoComplete="new-password"
					required
					minLength={8}
					disabled={isBusy}
					helper="8 characters minimum."
				/>
				{error && <AuthMessage tone="error">{error}</AuthMessage>}
				<AuthButton type="submit" disabled={isBusy}>
					{isBusy ? "Updating…" : "Update password"}
				</AuthButton>
			</form>
		</AuthPage>
	);
}
