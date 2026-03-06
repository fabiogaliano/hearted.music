/**
 * /login - Social login page
 *
 * Public route. Redirects to /dashboard if already authenticated.
 * Provides Google sign-in via Better Auth social providers.
 */

import { useState } from "react";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { signIn } from "@/lib/auth-client";
import { getAuthSession } from "@/lib/server/auth.functions";
import { fonts } from "@/lib/theme/fonts";

export const Route = createFileRoute("/login")({
	beforeLoad: async () => {
		const session = await getAuthSession();
		if (session) {
			throw redirect({ to: "/dashboard" });
		}
	},
	component: LoginPage,
});

function LoginPage() {
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState<string | null>(null);

	async function handleGoogleLogin() {
		setError(null);
		setLoading("google");
		try {
			await signIn.social({ provider: "google", callbackURL: "/dashboard" });
		} catch {
			setError("Failed to sign in with Google. Please try again.");
			setLoading(null);
		}
	}

	return (
		<div className="flex min-h-screen items-center justify-center bg-neutral-50">
			<div className="w-full max-w-sm space-y-6 px-6">
				<div className="text-center">
					<h1 className="text-3xl" style={{ fontFamily: fonts.display }}>
						Sign in to hearted.
					</h1>
				</div>

				{error && <p className="text-center text-sm text-red-600">{error}</p>}

				<div className="space-y-3">
					<button
						type="button"
						disabled={loading !== null}
						onClick={handleGoogleLogin}
						className="flex w-full items-center justify-center gap-3 rounded-md border border-neutral-200 bg-white px-4 py-3 text-sm font-medium text-neutral-800 transition-colors hover:bg-neutral-50 disabled:opacity-50"
					>
						<GoogleIcon />
						{loading === "google" ? "Redirecting..." : "Continue with Google"}
					</button>
				</div>

				<div className="text-center">
					<Link
						to="/"
						className="text-sm text-neutral-500 transition-colors hover:text-neutral-700"
					>
						Back
					</Link>
				</div>
			</div>
		</div>
	);
}

function GoogleIcon() {
	return (
		<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
			<path
				d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
				fill="#4285F4"
			/>
			<path
				d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z"
				fill="#34A853"
			/>
			<path
				d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
				fill="#FBBC05"
			/>
			<path
				d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
				fill="#EA4335"
			/>
		</svg>
	);
}
