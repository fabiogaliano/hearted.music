import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import {
	VerifyEmailPanel,
	type VerifyEmailPhase,
} from "@/features/auth/VerifyEmailPanel";
import { sendVerificationEmail } from "@/lib/platform/auth/auth-client";

const searchSchema = z.object({
	error: z.string().optional(),
	email: z.string().optional(),
});

export const Route = createFileRoute("/verify-email")({
	validateSearch: searchSchema,
	component: VerifyEmailPage,
});

function VerifyEmailPage() {
	const { error, email } = Route.useSearch();
	const navigate = useNavigate();

	const initialPhase: VerifyEmailPhase = error
		? error.toUpperCase().includes("EXPIRED")
			? "expired"
			: "error"
		: "success";

	const [phase, setPhase] = useState<VerifyEmailPhase>(initialPhase);
	const [errorMessage] = useState<string | null>(error ?? null);

	async function handleResend() {
		if (!email) {
			navigate({ to: "/login" });
			return;
		}
		await sendVerificationEmail({
			email,
			callbackURL: "/verify-email",
		});
		setPhase("success");
	}

	return (
		<VerifyEmailPanel
			phase={phase}
			errorMessage={errorMessage}
			onContinue={() => navigate({ to: "/login" })}
			onResend={handleResend}
		/>
	);
}
