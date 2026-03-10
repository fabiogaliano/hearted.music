import { useState } from "react";
import { joinWaitlist } from "@/lib/server/waitlist.functions";
import { fonts } from "@/lib/theme/fonts";
import { useTheme } from "@/lib/theme/ThemeHueProvider";

export interface WaitlistInputProps {
	buttonText?: string;
	/** 'light' for light backgrounds, 'dark' for dark/gradient backgrounds */
	variant?: "light" | "dark";
}

type Status = "idle" | "submitting" | "success" | "error";

export function WaitlistInput({
	buttonText = "TELL ME",
	variant = "light",
}: WaitlistInputProps) {
	const theme = useTheme();
	const isDark = variant === "dark";

	const [email, setEmail] = useState("");
	const [status, setStatus] = useState<Status>("idle");
	const [errorMsg, setErrorMsg] = useState("");

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!email.trim() || status === "submitting") return;

		setStatus("submitting");
		setErrorMsg("");

		try {
			const result = await joinWaitlist({ data: { email: email.trim() } });
			if (result.success) {
				setStatus("success");
			} else {
				setErrorMsg(result.error ?? "Something went wrong.");
				setStatus("error");
			}
		} catch {
			setErrorMsg("Something went wrong. Try again.");
			setStatus("error");
		}
	};

	if (status === "success") {
		return (
			<p
				className="text-lg font-light"
				style={{
					color: isDark ? "#ffffff" : theme.text,
					fontFamily: fonts.body,
				}}
			>
				You're on the list. The stories are already there, you'll be first to
				hear them.
			</p>
		);
	}

	return (
		<form onSubmit={handleSubmit} className="flex flex-col gap-2">
			<div className="flex max-w-sm gap-3">
				<input
					type="email"
					required
					value={email}
					onChange={(e) => setEmail(e.target.value)}
					placeholder="Your email"
					disabled={status === "submitting"}
					className="flex-1 px-4 py-3 text-sm transition-all duration-300 focus:outline-none disabled:opacity-60"
					style={{
						background: isDark ? "rgba(255,255,255,0.15)" : theme.surface,
						border: `1px solid ${isDark ? "rgba(255,255,255,0.3)" : theme.border}`,
						color: isDark ? "#ffffff" : theme.text,
						fontFamily: fonts.body,
						backdropFilter: isDark ? "blur(10px)" : undefined,
					}}
				/>
				<button
					type="submit"
					disabled={status === "submitting"}
					className="px-6 py-3 text-sm tracking-widest uppercase transition-all duration-300 hover:scale-105 disabled:opacity-60 disabled:hover:scale-100"
					style={{
						background: theme.textOnPrimary,
						color: theme.primary,
						fontFamily: fonts.body,
					}}
				>
					{status === "submitting" ? "..." : buttonText}
				</button>
			</div>
			{status === "error" && (
				<p
					className="text-sm"
					style={{ color: isDark ? "#fca5a5" : "#dc2626" }}
				>
					{errorMsg}
				</p>
			)}
		</form>
	);
}
