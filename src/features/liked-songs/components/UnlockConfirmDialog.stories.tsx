import type { Story } from "@ladle/react";
import { useCallback, useState } from "react";
import { UnlockConfirmDialog } from "./UnlockConfirmDialog";
import type { BillingState } from "@/lib/domains/billing/state";
import type { UnlockFlowState } from "../hooks/useSongUnlock";

const freeBillingState: BillingState = {
	plan: "free",
	creditBalance: 0,
	subscriptionStatus: "none",
	cancelAtPeriodEnd: false,
	unlimitedAccess: { kind: "none" },
	queueBand: "low",
};

const SONG_IDS = ["id-1", "id-2", "id-3"];

function InteractiveDialog({
	initialState,
	remainingBalance = 50,
	billingState = freeBillingState,
}: {
	initialState: UnlockFlowState;
	remainingBalance?: number;
	billingState?: BillingState;
}) {
	const [flowState, setFlowState] = useState<UnlockFlowState>(initialState);

	const handleConfirm = useCallback(() => {
		if (flowState.step !== "confirming") return;
		const { songIds } = flowState;
		setFlowState({ step: "unlocking", songIds });
		setTimeout(() => {
			setFlowState({
				step: "success",
				newlyUnlockedIds: songIds,
				alreadyUnlockedIds: [],
				remainingBalance: remainingBalance - songIds.length,
			});
		}, 1200);
	}, [flowState, remainingBalance]);

	const reset = useCallback(() => setFlowState(initialState), [initialState]);

	return (
		<div style={{ minHeight: "100vh", position: "relative" }}>
			{flowState.step === "idle" && (
				<div style={{ padding: 24, textAlign: "center", opacity: 0.6 }}>
					<p>Dialog dismissed.</p>
					<button
						type="button"
						onClick={reset}
						style={{ marginTop: 12, cursor: "pointer" }}
					>
						Reopen
					</button>
				</div>
			)}
			<UnlockConfirmDialog
				flowState={flowState}
				remainingBalance={remainingBalance}
				billingState={billingState}
				onConfirm={handleConfirm}
				onCancel={reset}
				onDismiss={() => setFlowState({ step: "idle" })}
			/>
		</div>
	);
}

export const Confirming: Story = () => (
	<InteractiveDialog initialState={{ step: "confirming", songIds: SONG_IDS }} />
);
Confirming.meta = {
	description:
		"Confirmation dialog — 3 songs, 50 balance. Cancel resets, Confirm walks through unlocking → success → auto-dismiss.",
};

export const ConfirmingSingleSong: Story = () => (
	<InteractiveDialog
		initialState={{ step: "confirming", songIds: ["id-1"] }}
		remainingBalance={12}
	/>
);

export const Unlocking: Story = () => (
	<InteractiveDialog initialState={{ step: "unlocking", songIds: SONG_IDS }} />
);

export const Success: Story = () => (
	<InteractiveDialog
		initialState={{
			step: "success",
			newlyUnlockedIds: ["id-1", "id-2"],
			alreadyUnlockedIds: [],
			remainingBalance: 48,
		}}
		remainingBalance={48}
	/>
);
Success.meta = { description: "Auto-dismisses after 2.5s via onDismiss." };

export const InsufficientBalance: Story = () => (
	<InteractiveDialog
		initialState={{ step: "insufficient_balance", required: 10, available: 3 }}
		remainingBalance={3}
	/>
);
InsufficientBalance.meta = {
	description: "Not enough credits. Embeds PaywallCTA. Close button dismisses.",
};

export const ErrorState: Story = () => (
	<InteractiveDialog
		initialState={{
			step: "error",
			message: "Failed to unlock songs. Please try again.",
		}}
	/>
);
