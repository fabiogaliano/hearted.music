/**
 * /login - Sign in / sign up.
 *
 * Public route. Redirects to /dashboard if already authenticated.
 * Supports Google social login plus email/password (Better Auth).
 * `?mode=signup` opens the form in sign-up state.
 */

import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import {
	LoginForm,
	type LoginMode,
	type SubmitHandler,
} from "@/features/auth/LoginForm";
import { useAnalytics } from "@/lib/observability/useAnalytics";
import { signIn, signUp } from "@/lib/platform/auth/auth-client";
import { getAuthSession } from "@/lib/server/auth.functions";

const searchSchema = z.object({
	mode: z.enum(["signin", "signup"]).optional(),
});

export const Route = createFileRoute("/login")({
	validateSearch: searchSchema,
	beforeLoad: async () => {
		const session = await getAuthSession();
		if (session) {
			throw redirect({ to: "/dashboard" });
		}
	},
	component: LoginPage,
});

type LoadingState = "google" | "credentials" | null;

function LoginPage() {
	const { mode: initialMode } = Route.useSearch();
	const navigate = useNavigate();
	const analytics = useAnalytics();

	const [mode, setMode] = useState<LoginMode>(initialMode ?? "signin");
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [loading, setLoading] = useState<LoadingState>(null);

	async function handleGoogle() {
		setError(null);
		setNotice(null);
		setLoading("google");
		analytics.capture("user_logged_in", { provider: "google" });
		try {
			await signIn.social({
				provider: "google",
				callbackURL: "/dashboard",
				newUserCallbackURL: "/onboarding",
			});
		} catch {
			analytics.capture("login_error", { provider: "google" });
			setError("Something went sideways. Let's try that again.");
			setLoading(null);
		}
	}

	const handleSubmit: SubmitHandler = async ({
		mode: submittedMode,
		email,
		password,
		name,
	}) => {
		setError(null);
		setNotice(null);
		setLoading("credentials");

		if (submittedMode === "signup") {
			analytics.capture("user_signed_up", { provider: "credentials" });
			const { error: err } = await signUp.email({
				email,
				password,
				name,
				callbackURL: "/onboarding",
			});
			if (err) {
				analytics.capture("signup_error", { provider: "credentials" });
				setError(humanizeAuthError(err.message ?? "Could not create account."));
				setLoading(null);
				return;
			}
			// requireEmailVerification means sign-up creates the account but
			// issues no session — the user must click the verification link
			// before they can sign in. Switch to the sign-in form with a notice
			// rather than navigating into the authenticated area, which would
			// just bounce back to /login with no explanation.
			setMode("signin");
			setNotice(
				`One step left. We sent a verification link to ${email}. If it's not in your inbox, check spam.`,
			);
			setLoading(null);
			return;
		}

		analytics.capture("user_logged_in", { provider: "credentials" });
		const { error: err } = await signIn.email({
			email,
			password,
			callbackURL: "/dashboard",
		});
		if (err) {
			analytics.capture("login_error", { provider: "credentials" });
			setError(humanizeAuthError(err.message ?? "Could not sign in."));
			setLoading(null);
			return;
		}
		navigate({ to: "/dashboard" });
	};

	function handleForgotPassword() {
		navigate({ to: "/forgot-password" });
	}

	function handleModeChange(next: LoginMode) {
		setMode(next);
		setError(null);
		setNotice(null);
	}

	return (
		<LoginForm
			mode={mode}
			onModeChange={handleModeChange}
			onSubmit={handleSubmit}
			onGoogle={handleGoogle}
			onForgotPassword={handleForgotPassword}
			error={error}
			notice={notice}
			loading={loading}
		/>
	);
}

// Better Auth surfaces machine-y messages ("INVALID_EMAIL_OR_PASSWORD" etc.).
// Translate the common ones into Hearted voice. Unknown messages pass through
// after stripping ALL_CAPS shouting.
function humanizeAuthError(raw: string): string {
	const upper = raw.toUpperCase();
	if (upper.includes("INVALID_EMAIL_OR_PASSWORD"))
		return "That email and password don't match.";
	if (upper.includes("USER_ALREADY_EXISTS"))
		return "An account with that email already exists. Try signing in.";
	if (upper.includes("PASSWORD_TOO_SHORT"))
		return "Password needs at least 8 characters.";
	if (upper.includes("EMAIL_NOT_VERIFIED"))
		return "Check your inbox to verify this email first.";
	return raw;
}
