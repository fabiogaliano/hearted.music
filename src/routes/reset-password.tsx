import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import {
	ResetPasswordForm,
	type ResetPasswordPhase,
} from "@/features/auth/ResetPasswordForm";
import { useAnalytics } from "@/lib/observability/useAnalytics";
import { resetPassword } from "@/lib/platform/auth/auth-client";

const searchSchema = z.object({
	token: z.string().optional(),
	error: z.string().optional(),
});

export const Route = createFileRoute("/reset-password")({
	validateSearch: searchSchema,
	component: ResetPasswordPage,
});

function ResetPasswordPage() {
	const { token, error: redirectError } = Route.useSearch();
	const navigate = useNavigate();
	const analytics = useAnalytics();

	const initialPhase: ResetPasswordPhase =
		!token || redirectError ? "token-invalid" : "idle";

	const [phase, setPhase] = useState<ResetPasswordPhase>(initialPhase);
	const [error, setError] = useState<string | null>(null);

	async function handleSubmit(newPassword: string) {
		if (!token) {
			setPhase("token-invalid");
			return;
		}
		setError(null);
		setPhase("submitting");
		const { error: err } = await resetPassword({ newPassword, token });
		if (err) {
			analytics.capture("password_reset_failed");
			const upper = (err.message ?? "").toUpperCase();
			if (upper.includes("INVALID_TOKEN")) {
				setPhase("token-invalid");
				return;
			}
			if (upper.includes("PASSWORD_TOO_SHORT")) {
				setError("Password needs at least 8 characters.");
				setPhase("idle");
				return;
			}
			setError("Something went sideways. Let's try that again.");
			setPhase("idle");
			return;
		}
		analytics.capture("password_reset_succeeded");
		setPhase("success");
	}

	return (
		<ResetPasswordForm
			phase={phase}
			error={error}
			onSubmit={handleSubmit}
			onBackToLogin={() => navigate({ to: "/login" })}
			onRequestNew={() => navigate({ to: "/forgot-password" })}
		/>
	);
}
