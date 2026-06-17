import {
	CheckCircleIcon,
	CircleNotchIcon,
	LockSimpleIcon,
	WarningIcon,
	XIcon,
} from "@phosphor-icons/react";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/Button";
import { PaywallCTA } from "@/features/billing/components/PaywallCTA";
import { PaywallDialog } from "@/features/billing/components/PaywallDialog";
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
	const dialogRef = useRef<HTMLDivElement>(null);
	const titleId = useId();
	const descriptionId = useId();
	const isConfirming = flowState.step === "confirming";
	const isDismissable =
		flowState.step === "confirming" ||
		flowState.step === "insufficient_balance" ||
		flowState.step === "error";
	const dismissAction = isConfirming ? onCancel : onDismiss;

	useShortcut({
		key: "escape",
		handler: dismissAction,
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

	useEffect(() => {
		if (flowState.step === "idle" || flowState.step === "paywall") return;

		const previouslyFocused = document.activeElement;
		dialogRef.current?.focus();

		return () => {
			if (
				previouslyFocused instanceof HTMLElement &&
				previouslyFocused.isConnected
			) {
				previouslyFocused.focus();
			}
		};
	}, [flowState.step]);

	if (flowState.step === "idle") return null;
	if (flowState.step === "paywall") {
		return <PaywallDialog billingState={billingState} onClose={onDismiss} />;
	}

	return createPortal(
		<div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
			<button
				type="button"
				aria-label="Close dialog"
				className="dialog-backdrop absolute inset-0 cursor-default appearance-none border-0 bg-black/50 p-0 backdrop-blur-sm"
				onClick={() => {
					if (!isDismissable) return;
					dismissAction();
				}}
			/>
			<div
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				aria-describedby={descriptionId}
				tabIndex={-1}
				className="theme-surface-bg theme-border-color dialog-content relative w-full max-w-md border p-6 outline-none"
			>
				{flowState.step === "confirming" && (
					<ConfirmContent
						titleId={titleId}
						descriptionId={descriptionId}
						songCount={flowState.songIds.length}
						remainingBalance={remainingBalance}
						onConfirm={onConfirm}
						onCancel={onCancel}
					/>
				)}

				{flowState.step === "unlocking" && (
					<div className="flex flex-col items-center gap-4 py-4">
						<CircleNotchIcon
							size={24}
							className="theme-primary animate-spin"
							weight="regular"
						/>
						<p
							id={titleId}
							className="theme-text text-sm"
							style={{ fontFamily: fonts.body }}
						>
							Unlocking {flowState.songIds.length}{" "}
							{flowState.songIds.length === 1 ? "song" : "songs"}…
						</p>
						<p id={descriptionId} className="sr-only">
							Please wait while your songs unlock.
						</p>
					</div>
				)}

				{flowState.step === "success" && (
					<div className="flex flex-col items-center gap-4 py-4">
						<CheckCircleIcon size={24} className="theme-primary" />
						<div className="text-center">
							<p
								id={titleId}
								className="theme-text text-sm"
								style={{ fontFamily: fonts.body }}
							>
								{flowState.newlyUnlockedIds.length}{" "}
								{flowState.newlyUnlockedIds.length === 1 ? "song" : "songs"}{" "}
								unlocked
							</p>
							<p
								id={descriptionId}
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
						<WarningIcon size={24} className="theme-primary" weight="regular" />
						<div className="text-center">
							<p
								id={titleId}
								className="theme-text text-sm"
								style={{ fontFamily: fonts.body }}
							>
								Not enough songs to explore
							</p>
							<p
								id={descriptionId}
								className="theme-text-muted mt-1 text-xs"
								style={{ fontFamily: fonts.body }}
							>
								You selected {flowState.required} songs but have{" "}
								{flowState.available} remaining.
							</p>
						</div>
						<PaywallCTA billingState={billingState} compact />
						<Button
							variant="ghost"
							onClick={onDismiss}
							className="mt-2"
							style={{ fontFamily: fonts.body }}
						>
							Close
						</Button>
					</div>
				)}

				{flowState.step === "error" && (
					<div className="flex flex-col items-center gap-4 py-4">
						<WarningIcon size={24} className="theme-primary" weight="regular" />
						<p
							id={titleId}
							className="theme-text text-center text-sm"
							style={{ fontFamily: fonts.body }}
						>
							{flowState.message}
						</p>
						<p id={descriptionId} className="sr-only">
							Dialog actions are available below.
						</p>
						<Button
							onClick={onDismiss}
							className="mt-2"
							style={{ fontFamily: fonts.body }}
						>
							Close
						</Button>
					</div>
				)}
			</div>
		</div>,
		document.body,
	);
}

function ConfirmContent({
	titleId,
	descriptionId,
	songCount,
	remainingBalance,
	onConfirm,
	onCancel,
}: {
	titleId: string;
	descriptionId: string;
	songCount: number;
	remainingBalance: number;
	onConfirm: () => void;
	onCancel: () => void;
}) {
	const balanceAfter = remainingBalance - songCount;

	return (
		<>
			<Button
				variant="icon"
				onClick={onCancel}
				className="absolute top-4 right-4"
				aria-label="Cancel"
			>
				<XIcon size={16} />
			</Button>

			<div className="flex flex-col items-center gap-4">
				<LockSimpleIcon size={24} className="theme-primary" weight="regular" />
				<div className="text-center">
					<p
						id={titleId}
						className="theme-text text-base"
						style={{ fontFamily: fonts.body }}
					>
						See what's inside?
					</p>
					<p
						id={descriptionId}
						className="theme-text-muted mt-2 text-xs"
						style={{ fontFamily: fonts.body }}
					>
						{balanceAfter} more waiting after this
					</p>
				</div>

				<div className="mt-2 flex gap-3">
					<Button
						variant="secondary"
						onClick={onCancel}
						style={{ fontFamily: fonts.body }}
					>
						Cancel
					</Button>
					<Button
						onClick={onConfirm}
						className="rounded-full"
						style={{ fontFamily: fonts.body }}
					>
						Unlock
					</Button>
				</div>
			</div>
		</>
	);
}
