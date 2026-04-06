import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { billingKeys } from "@/features/billing/query-keys";
import { requestSongUnlock } from "@/lib/server/billing.functions";
import type { RequestSongUnlockResponse } from "@/lib/server/billing.functions";
import { likedSongsKeys } from "../queries";

export type UnlockFlowState =
	| { step: "idle" }
	| { step: "confirming"; songIds: string[] }
	| { step: "unlocking"; songIds: string[] }
	| {
			step: "success";
			newlyUnlockedIds: string[];
			alreadyUnlockedIds: string[];
			remainingBalance: number;
	  }
	| {
			step: "insufficient_balance";
			required: number;
			available: number;
	  }
	| { step: "error"; message: string };

export function useSongUnlock(accountId: string) {
	const queryClient = useQueryClient();
	const [flowState, setFlowState] = useState<UnlockFlowState>({ step: "idle" });

	const requestConfirmation = useCallback((songIds: string[]) => {
		setFlowState({ step: "confirming", songIds });
	}, []);

	const cancelConfirmation = useCallback(() => {
		setFlowState({ step: "idle" });
	}, []);

	const confirmUnlock = useCallback(async () => {
		if (flowState.step !== "confirming") return;

		const { songIds } = flowState;
		setFlowState({ step: "unlocking", songIds });

		let response: RequestSongUnlockResponse;
		try {
			response = await requestSongUnlock({ data: { songIds } });
		} catch {
			setFlowState({
				step: "error",
				message: "Failed to unlock songs. Please try again.",
			});
			return;
		}

		if (response.success) {
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: likedSongsKeys.all }),
				queryClient.invalidateQueries({
					queryKey: likedSongsKeys.stats(accountId),
				}),
				queryClient.invalidateQueries({ queryKey: billingKeys.state }),
			]);

			setFlowState({
				step: "success",
				newlyUnlockedIds: response.newlyUnlockedIds,
				alreadyUnlockedIds: response.alreadyUnlockedIds,
				remainingBalance: response.remainingBalance,
			});
		} else {
			switch (response.error) {
				case "insufficient_balance":
					setFlowState({
						step: "insufficient_balance",
						required: response.required,
						available: response.available,
					});
					break;
				case "invalid_songs":
					setFlowState({
						step: "error",
						message: `Some selected songs are no longer available.`,
					});
					break;
				case "unlimited_access_active":
					setFlowState({
						step: "error",
						message: "You have unlimited access — no need to unlock songs.",
					});
					break;
				case "internal_error":
					setFlowState({
						step: "error",
						message: "Something went wrong. Please try again.",
					});
					break;
			}
		}
	}, [flowState, queryClient, accountId]);

	const dismiss = useCallback(() => {
		setFlowState({ step: "idle" });
	}, []);

	return {
		flowState,
		requestConfirmation,
		cancelConfirmation,
		confirmUnlock,
		dismiss,
	};
}
