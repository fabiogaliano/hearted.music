import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
	ForgotPasswordForm,
	type ForgotPasswordPhase,
} from "@/features/auth/ForgotPasswordForm";
import { useAnalytics } from "@/lib/observability/useAnalytics";
import { requestPasswordReset } from "@/lib/platform/auth/auth-client";

export const Route = createFileRoute("/forgot-password")({
	component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
	const navigate = useNavigate();
	const analytics = useAnalytics();
	const [phase, setPhase] = useState<ForgotPasswordPhase>("idle");
	const [error, setError] = useState<string | null>(null);

	async function handleSubmit(email: string) {
		setError(null);
		setPhase("submitting");
		analytics.capture("password_reset_requested");
		const { error: err } = await requestPasswordReset({
			email,
			redirectTo: "/reset-password",
		});
		if (err) {
			// Don't leak whether the email exists — show the same confirmation
			// either way. Only surface infrastructure errors.
			if (err.status && err.status >= 500) {
				setError("Something went sideways. Try again in a moment.");
				setPhase("error");
				return;
			}
		}
		setPhase("submitted");
	}

	return (
		<ForgotPasswordForm
			phase={phase}
			error={error}
			onSubmit={handleSubmit}
			onBackToLogin={() => navigate({ to: "/login" })}
		/>
	);
}
