/**
 * Billing server functions.
 */

import { createServerFn } from "@tanstack/react-start";
import { Result } from "better-result";
import { z } from "zod";
import { authMiddleware } from "@/lib/platform/auth/auth.middleware";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { readBillingState } from "@/lib/domains/billing/queries";
import type { BillingState } from "@/lib/domains/billing/state";
import { requestSongUnlock as orchestrateUnlock } from "@/lib/domains/billing/unlocks";

export const getBillingState = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.handler(async ({ context }): Promise<BillingState> => {
		const supabase = createAdminSupabaseClient();
		const result = await readBillingState(supabase, context.session.accountId);

		if (Result.isError(result)) {
			throw new Error("Failed to load billing state");
		}

		return result.value;
	});

const RequestSongUnlockSchema = z.object({
	songIds: z.array(z.string().uuid()).min(1).max(500),
});

export type RequestSongUnlockResponse =
	| {
			success: true;
			newlyUnlockedIds: string[];
			alreadyUnlockedIds: string[];
			remainingBalance: number;
	  }
	| {
			success: false;
			error: "insufficient_balance";
			required: number;
			available: number;
	  }
	| { success: false; error: "invalid_songs"; songIds: string[] }
	| { success: false; error: "unlimited_access_active" }
	| { success: false; error: "internal_error" };

export const requestSongUnlock = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data) => RequestSongUnlockSchema.parse(data))
	.handler(async ({ data, context }): Promise<RequestSongUnlockResponse> => {
		const supabase = createAdminSupabaseClient();
		const result = await orchestrateUnlock(
			supabase,
			context.session.accountId,
			data.songIds,
		);

		if (Result.isError(result)) {
			const err = result.error;
			switch (err.kind) {
				case "insufficient_balance":
					return {
						success: false,
						error: "insufficient_balance",
						required: err.required,
						available: err.available,
					};
				case "invalid_songs":
					return {
						success: false,
						error: "invalid_songs",
						songIds: err.songIds,
					};
				case "unlimited_access_active":
					return { success: false, error: "unlimited_access_active" };
				case "db_error":
					return { success: false, error: "internal_error" };
			}
		}

		return {
			success: true,
			newlyUnlockedIds: result.value.newlyUnlockedIds,
			alreadyUnlockedIds: result.value.alreadyUnlockedIds,
			remainingBalance: result.value.remainingBalance,
		};
	});
