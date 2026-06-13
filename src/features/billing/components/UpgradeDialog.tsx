import type { BillingState } from "@/lib/domains/billing/state";
import { PaywallDialog } from "./PaywallDialog";

interface UpgradeDialogProps {
	billingState: BillingState;
	onClose: () => void;
}

export function UpgradeDialog({ billingState, onClose }: UpgradeDialogProps) {
	return <PaywallDialog billingState={billingState} onClose={onClose} />;
}
