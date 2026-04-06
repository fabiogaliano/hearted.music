import { Lock, Loader2, AlertTriangle, CheckCircle, X } from "lucide-react";
import { useEffect } from "react";

import { PaywallCTA } from "@/features/billing/components/PaywallCTA";
import type { BillingState } from "@/lib/domains/billing/state";
import { fonts } from "@/lib/theme/fonts";
import { useTheme } from "@/lib/theme/ThemeHueProvider";

import type { UnlockFlowState } from "../hooks/useSongUnlock";

interface UnlockConfirmDialogProps {
	flowState: UnlockFlowState;
	remainingBalance: number;
	billingState: BillingState;
	onConfirm: () => void;
	onCancel: () => void;
	onDismiss: () => void;
}

export function UnlockConfirmDialog({
	flowState,
	remainingBalance,
	billingState,
	onConfirm,
	onCancel,
	onDismiss,
}: UnlockConfirmDialogProps) {
	const theme = useTheme();

	useEffect(() => {
		if (flowState.step === "success") {
			const timer = setTimeout(onDismiss, 2500);
			return () => clearTimeout(timer);
		}
	}, [flowState.step, onDismiss]);

	if (flowState.step === "idle") return null;

	return (
		<div
			className="fixed inset-0 z-[60] flex items-center justify-center p-4"
			style={{ background: "rgba(0,0,0,0.5)" }}
		>
			<div
				className="relative w-full max-w-md rounded-xl p-6"
				style={{
					background: theme.surface,
					border: `1px solid ${theme.border}`,
				}}
			>
				{flowState.step === "confirming" && (
					<ConfirmContent
						songCount={flowState.songIds.length}
						remainingBalance={remainingBalance}
						theme={theme}
						onConfirm={onConfirm}
						onCancel={onCancel}
					/>
				)}

				{flowState.step === "unlocking" && (
					<div className="flex flex-col items-center gap-4 py-4">
						<Loader2 size={24} className="animate-spin" color={theme.primary} />
						<p
							className="text-sm"
							style={{ fontFamily: fonts.body, color: theme.text }}
						>
							Unlocking {flowState.songIds.length}{" "}
							{flowState.songIds.length === 1 ? "song" : "songs"}…
						</p>
					</div>
				)}

				{flowState.step === "success" && (
					<div className="flex flex-col items-center gap-4 py-4">
						<CheckCircle size={24} color={theme.primary} />
						<div className="text-center">
							<p
								className="text-sm"
								style={{ fontFamily: fonts.body, color: theme.text }}
							>
								{flowState.newlyUnlockedIds.length}{" "}
								{flowState.newlyUnlockedIds.length === 1 ? "song" : "songs"}{" "}
								unlocked
							</p>
							<p
								className="mt-1 text-xs"
								style={{ fontFamily: fonts.body, color: theme.textMuted }}
							>
								{flowState.remainingBalance} songs to explore remaining
							</p>
						</div>
					</div>
				)}

				{flowState.step === "insufficient_balance" && (
					<div className="flex flex-col items-center gap-4 py-4">
						<AlertTriangle size={24} color={theme.primary} />
						<div className="text-center">
							<p
								className="text-sm"
								style={{ fontFamily: fonts.body, color: theme.text }}
							>
								Not enough songs to explore
							</p>
							<p
								className="mt-1 text-xs"
								style={{ fontFamily: fonts.body, color: theme.textMuted }}
							>
								You selected {flowState.required} songs but have{" "}
								{flowState.available} remaining.
							</p>
						</div>
						<PaywallCTA billingState={billingState} compact />
						<button
							type="button"
							onClick={onDismiss}
							className="mt-2 cursor-pointer rounded-full border-0 px-5 py-2 text-sm transition-opacity hover:opacity-90"
							style={{
								fontFamily: fonts.body,
								background: "transparent",
								color: theme.textMuted,
							}}
						>
							Close
						</button>
					</div>
				)}

				{flowState.step === "error" && (
					<div className="flex flex-col items-center gap-4 py-4">
						<AlertTriangle size={24} color={theme.primary} />
						<p
							className="text-center text-sm"
							style={{ fontFamily: fonts.body, color: theme.text }}
						>
							{flowState.message}
						</p>
						<button
							type="button"
							onClick={onDismiss}
							className="mt-2 cursor-pointer rounded-full border-0 px-5 py-2 text-sm transition-opacity hover:opacity-90"
							style={{
								fontFamily: fonts.body,
								background: theme.primary,
								color: theme.bg,
							}}
						>
							Close
						</button>
					</div>
				)}
			</div>
		</div>
	);
}

function ConfirmContent({
	songCount,
	remainingBalance,
	theme,
	onConfirm,
	onCancel,
}: {
	songCount: number;
	remainingBalance: number;
	theme: ReturnType<typeof useTheme>;
	onConfirm: () => void;
	onCancel: () => void;
}) {
	const balanceAfter = remainingBalance - songCount;

	return (
		<>
			<button
				type="button"
				onClick={onCancel}
				className="absolute top-4 right-4 cursor-pointer border-0 bg-transparent"
				style={{ color: theme.textMuted }}
				aria-label="Cancel"
			>
				<X size={16} />
			</button>

			<div className="flex flex-col items-center gap-4">
				<Lock size={24} color={theme.primary} />
				<div className="text-center">
					<p
						className="text-base"
						style={{ fontFamily: fonts.display, color: theme.text }}
					>
						Explore {songCount} {songCount === 1 ? "song" : "songs"}?
					</p>
					<p
						className="mt-2 text-xs"
						style={{ fontFamily: fonts.body, color: theme.textMuted }}
					>
						{balanceAfter} songs to explore remaining after unlock
					</p>
				</div>

				<div className="mt-2 flex gap-3">
					<button
						type="button"
						onClick={onCancel}
						className="cursor-pointer rounded-full border px-4 py-2 text-sm transition-opacity hover:opacity-80"
						style={{
							fontFamily: fonts.body,
							background: "transparent",
							borderColor: theme.border,
							color: theme.text,
						}}
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={onConfirm}
						className="cursor-pointer rounded-full border-0 px-5 py-2 text-sm transition-opacity hover:opacity-90"
						style={{
							fontFamily: fonts.body,
							background: theme.primary,
							color: theme.bg,
						}}
					>
						Unlock
					</button>
				</div>
			</div>
		</>
	);
}
