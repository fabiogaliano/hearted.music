import { XIcon } from "@phosphor-icons/react";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Button";
import type { BillingState } from "@/lib/domains/billing/state";
import { useShortcut } from "@/lib/keyboard/useShortcut";
import { fonts } from "@/lib/theme/fonts";
import { PaywallCTA } from "./PaywallCTA";

interface PaywallDialogProps {
	billingState: BillingState;
	onClose: () => void;
}

export function PaywallDialog({ billingState, onClose }: PaywallDialogProps) {
	const dialogRef = useRef<HTMLDivElement>(null);
	const titleId = useId();
	const descriptionId = useId();

	useShortcut({
		key: "escape",
		handler: onClose,
		description: "Close paywall dialog",
		scope: "modal",
		category: "actions",
		enabled: true,
	});

	useEffect(() => {
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
	}, []);

	return createPortal(
		<div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
			<button
				type="button"
				aria-label="Close"
				className="dialog-backdrop absolute inset-0 cursor-default appearance-none border-0 bg-black/50 p-0 backdrop-blur-sm"
				onClick={onClose}
			/>
			<div
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				aria-describedby={descriptionId}
				tabIndex={-1}
				className="theme-surface-bg theme-border-color dialog-content relative w-full max-w-[420px] border p-6 outline-none"
			>
				<Button
					variant="icon"
					onClick={onClose}
					className="absolute top-4 right-4"
					aria-label="Close"
				>
					<XIcon size={16} />
				</Button>
				<div className="flex flex-col items-center gap-4 py-2">
					<div
						className="dialog-section text-center"
						style={{ animationDelay: "60ms" }}
					>
						<p
							id={titleId}
							className="theme-text text-3xl leading-tight tracking-tight text-balance"
							style={{ fontFamily: fonts.body }}
						>
							Hear every song
						</p>
						<p
							id={descriptionId}
							className="theme-text-muted mt-2 text-sm text-pretty"
							style={{ fontFamily: fonts.body }}
						>
							Grab a pack to explore the ones you choose, or go unlimited.
						</p>
					</div>
					<div
						className="dialog-section w-full"
						style={{ animationDelay: "140ms" }}
					>
						<PaywallCTA billingState={billingState} compact />
					</div>
				</div>
			</div>
		</div>,
		document.body,
	);
}
