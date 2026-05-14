import {
	CheckCircle,
	CircleNotch,
	LockSimple,
	Warning,
	X,
} from "@phosphor-icons/react";
import { useEffect } from "react";

import { PaywallCTA } from "@/features/billing/components/PaywallCTA";
import type { BillingState } from "@/lib/domains/billing/state";
import { useShortcut } from "@/lib/keyboard/useShortcut";
import { fonts } from "@/lib/theme/fonts";

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
	const isConfirming = flowState.step === "confirming";
	const isDismissable =
		flowState.step === "confirming" ||
		flowState.step === "insufficient_balance" ||
		flowState.step === "error";

	useShortcut({
		key: "escape",
		handler: isConfirming ? onCancel : onDismiss,
		description: isConfirming ? "Cancel unlock" : "Close dialog",
		scope: "modal",
		category: "actions",
		enabled: isDismissable,
	});

	useShortcut({
		key: "enter",
		handler: onConfirm,
		description: "Unlock songs",
		scope: "modal",
		category: "actions",
		enabled: isConfirming,
	});

	useEffect(() => {
		if (flowState.step === "success") {
			const timer = setTimeout(onDismiss, 2500);
			return () => clearTimeout(timer);
		}
	}, [flowState.step, onDismiss]);

	if (flowState.step === "idle") return null;

	return (
		<div className="dialog-backdrop fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
			<div className="theme-surface-bg theme-border-color dialog-content relative w-full max-w-md border p-6">
				{flowState.step === "confirming" && (
					<ConfirmContent
						songCount={flowState.songIds.length}
						remainingBalance={remainingBalance}
						onConfirm={onConfirm}
						onCancel={onCancel}
					/>
				)}

				{flowState.step === "unlocking" && (
					<div className="flex flex-col items-center gap-4 py-4">
						<CircleNotch
							size={24}
							className="theme-primary animate-spin"
							weight="regular"
						/>
						<p
							className="theme-text text-sm"
							style={{ fontFamily: fonts.body }}
						>
							Unlocking {flowState.songIds.length}{" "}
							{flowState.songIds.length === 1 ? "song" : "songs"}…
						</p>
					</div>
				)}

				{flowState.step === "success" && (
					<div className="flex flex-col items-center gap-4 py-4">
						<CheckCircle size={24} className="theme-primary" />
						<div className="text-center">
							<p
								className="theme-text text-sm"
								style={{ fontFamily: fonts.body }}
							>
								{flowState.newlyUnlockedIds.length}{" "}
								{flowState.newlyUnlockedIds.length === 1 ? "song" : "songs"}{" "}
								unlocked
							</p>
							<p
								className="theme-text-muted mt-1 text-xs"
								style={{ fontFamily: fonts.body }}
							>
								{flowState.remainingBalance} songs to explore remaining
							</p>
						</div>
					</div>
				)}

				{flowState.step === "insufficient_balance" && (
					<div className="flex flex-col items-center gap-4 py-4">
						<Warning size={24} className="theme-primary" weight="regular" />
						<div className="text-center">
							<p
								className="theme-text text-sm"
								style={{ fontFamily: fonts.body }}
							>
								Not enough songs to explore
							</p>
							<p
								className="theme-text-muted mt-1 text-xs"
								style={{ fontFamily: fonts.body }}
							>
								You selected {flowState.required} songs but have{" "}
								{flowState.available} remaining.
							</p>
						</div>
						<PaywallCTA billingState={billingState} compact />
						<button
							type="button"
							onClick={onDismiss}
							className="theme-text-muted mt-2 cursor-pointer border-0 bg-transparent px-5 py-2 text-sm transition-[transform,opacity] duration-150 hover:opacity-70 active:scale-[0.98]"
							style={{ fontFamily: fonts.body }}
						>
							Close
						</button>
					</div>
				)}

				{flowState.step === "error" && (
					<div className="flex flex-col items-center gap-4 py-4">
						<Warning size={24} className="theme-primary" weight="regular" />
						<p
							className="theme-text text-center text-sm"
							style={{ fontFamily: fonts.body }}
						>
							{flowState.message}
						</p>
						<button
							type="button"
							onClick={onDismiss}
							className="theme-primary-action mt-2 cursor-pointer px-5 py-2 text-sm transition-[transform,opacity] duration-150 hover:opacity-90 active:scale-[0.98]"
							style={{ fontFamily: fonts.body }}
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
	onConfirm,
	onCancel,
}: {
	songCount: number;
	remainingBalance: number;
	onConfirm: () => void;
	onCancel: () => void;
}) {
	const balanceAfter = remainingBalance - songCount;

	return (
		<>
			<button
				type="button"
				onClick={onCancel}
				className="theme-text-muted absolute top-4 right-4 cursor-pointer border-0 bg-transparent"
				aria-label="Cancel"
			>
				<X size={16} />
			</button>

			<div className="flex flex-col items-center gap-4">
				<LockSimple size={24} className="theme-primary" weight="regular" />
				<div className="text-center">
					<p
						className="theme-text text-base"
						style={{ fontFamily: fonts.display }}
					>
						Explore {songCount} {songCount === 1 ? "song" : "songs"}?
					</p>
					<p
						className="theme-text-muted mt-2 text-xs"
						style={{ fontFamily: fonts.body }}
					>
						{balanceAfter} songs to explore remaining after unlock
					</p>
				</div>

				<div className="mt-2 flex gap-3">
					<button
						type="button"
						onClick={onCancel}
						className="theme-border-color theme-text cursor-pointer border px-4 py-2 text-sm transition-[transform,background-color] duration-150 hover:bg-white/15 active:scale-[0.98]"
						style={{ fontFamily: fonts.body }}
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={onConfirm}
						className="theme-primary-action cursor-pointer rounded-full px-5 py-2 text-sm transition-[transform,opacity] duration-150 hover:opacity-90 active:scale-[0.98]"
						style={{ fontFamily: fonts.body }}
					>
						Unlock
					</button>
				</div>
			</div>
		</>
	);
}
