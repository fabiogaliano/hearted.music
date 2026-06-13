/**
 * Waitlist welcome server function.
 *
 * Temporary: greets waitlist members who received the automatic liked-song
 * access grant (origin `waitlist_auto`). The grant table is RLS deny-all, so
 * eligibility must be resolved server-side via the admin client. Remove this
 * file, its dialog, and its wiring in the authenticated layout once the
 * waitlist cohort has been greeted.
 */

import { createServerFn } from "@tanstack/react-start";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { authMiddleware } from "@/lib/platform/auth/auth.middleware";

export interface WaitlistWelcome {
	eligible: boolean;
}

export const getWaitlistWelcome = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.handler(async ({ context }): Promise<WaitlistWelcome> => {
		const supabase = createAdminSupabaseClient();
		const { data, error } = await supabase
			.from("account_liked_song_access_grant")
			.select("origin, applied_at")
			.eq("account_id", context.session.accountId)
			.maybeSingle();

		// Best-effort: a read failure should never surface the dialog. Better to
		// stay silent than to greet someone who may not be a waitlist member.
		if (error) {
			console.error(
				"[waitlist-welcome] Failed to read grant row:",
				error.message,
			);
			return { eligible: false };
		}

		return {
			eligible: data?.origin === "waitlist_auto" && data?.applied_at !== null,
		};
	});
