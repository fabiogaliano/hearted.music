import { useState } from "react";
import { fonts } from "@/lib/theme/fonts";

export type UnverifiedEmailBannerProps = {
	email: string;
	onResend: () => Promise<void> | void;
	onDismiss: () => void;
};

type Status = "idle" | "resending" | "resent";

export function UnverifiedEmailBanner({
	email,
	onResend,
	onDismiss,
}: UnverifiedEmailBannerProps) {
	const [status, setStatus] = useState<Status>("idle");

	async function handleResend() {
		setStatus("resending");
		try {
			await onResend();
			setStatus("resent");
		} catch {
			setStatus("idle");
		}
	}

	return (
		<div
			className="theme-border-color theme-bg flex flex-wrap items-center justify-between gap-3 border-b px-6 py-3"
			role="status"
			style={{ fontFamily: fonts.body }}
		>
			<p className="theme-text text-sm">
				{status === "resent" ? (
					<>
						We sent a fresh link to{" "}
						<span style={{ fontStyle: "italic" }}>{email}</span>.
					</>
				) : (
					<>
						Verify <span style={{ fontStyle: "italic" }}>{email}</span> to
						secure your account.
					</>
				)}
			</p>
			<div className="flex items-center gap-2">
				{status !== "resent" && (
					<button
						type="button"
						onClick={handleResend}
						disabled={status === "resending"}
						className="theme-text cursor-pointer text-xs tracking-widest uppercase transition-opacity duration-200 hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{status === "resending" ? "Sending…" : "Resend"}
					</button>
				)}
				<button
					type="button"
					onClick={onDismiss}
					className="theme-text-muted cursor-pointer text-xs tracking-widest uppercase transition-opacity duration-200 hover:opacity-70"
				>
					Dismiss
				</button>
			</div>
		</div>
	);
}
