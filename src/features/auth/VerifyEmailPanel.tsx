import {
	AuthButton,
	AuthInlineLink,
	AuthMessage,
	AuthPage,
} from "@/features/auth/AuthPage";

export type VerifyEmailPhase = "success" | "error" | "expired";

type VerifyEmailPanelProps = {
	phase: VerifyEmailPhase;
	errorMessage: string | null;
	onContinue: () => void;
	onResend: () => Promise<void> | void;
};

export function VerifyEmailPanel({
	phase,
	errorMessage,
	onContinue,
	onResend,
}: VerifyEmailPanelProps) {
	if (phase === "success") {
		return (
			<AuthPage
				headline={
					<>
						Email <span className="italic">confirmed.</span>
					</>
				}
				intro="Your library is ready to keep its secrets between you and us."
			>
				<AuthButton onClick={onContinue}>Continue</AuthButton>
			</AuthPage>
		);
	}

	if (phase === "expired") {
		return (
			<AuthPage
				headline={
					<>
						Link <span className="italic">expired.</span>
					</>
				}
				intro="Verification links don't stick around long. Want a fresh one?"
				footer={
					<AuthInlineLink onClick={onContinue}>Back to sign in</AuthInlineLink>
				}
			>
				<AuthButton onClick={onResend}>Send a new link</AuthButton>
			</AuthPage>
		);
	}

	return (
		<AuthPage
			headline={
				<>
					Something went <span className="italic">sideways.</span>
				</>
			}
			intro="We couldn't verify that email. Try again, or ask for a new link."
			footer={
				<AuthInlineLink onClick={onContinue}>Back to sign in</AuthInlineLink>
			}
		>
			{errorMessage && <AuthMessage tone="error">{errorMessage}</AuthMessage>}
			<div className="mt-4">
				<AuthButton onClick={onResend}>Send a new link</AuthButton>
			</div>
		</AuthPage>
	);
}
