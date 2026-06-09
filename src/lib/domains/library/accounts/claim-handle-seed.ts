import { derivePassiveHandlePrefill } from "./handle-prefill";

export type ClaimHandleSeed =
	| { kind: "owned"; handle: string }
	| { kind: "suggested"; handle: string }
	| { kind: "blank" };

export function deriveClaimHandleSeed({
	accountHandle,
	displayName,
}: {
	accountHandle: string | null;
	// Nullable because the account row's display_name column is nullable.
	displayName: string | null;
}): ClaimHandleSeed {
	if (accountHandle !== null) {
		return { kind: "owned", handle: accountHandle };
	}

	if (displayName !== null) {
		const suggested = derivePassiveHandlePrefill(displayName);
		if (suggested !== "") {
			return { kind: "suggested", handle: suggested };
		}
	}

	return { kind: "blank" };
}
