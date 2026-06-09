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
	displayName: string;
}): ClaimHandleSeed {
	if (accountHandle !== null) {
		return { kind: "owned", handle: accountHandle };
	}

	const suggested = derivePassiveHandlePrefill(displayName);
	if (suggested !== "") {
		return { kind: "suggested", handle: suggested };
	}

	return { kind: "blank" };
}
