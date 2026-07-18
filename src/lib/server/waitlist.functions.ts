/**
 * Server functions for waitlist signup.
 *
 * Public endpoint (no auth required).
 * Uses admin client because waitlist table RLS only allows service_role inserts.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { sendWaitlistConfirmation } from "@/lib/email/waitlist-confirmation";
import { captureServerError } from "@/lib/observability/capture-server-error";

const waitlistSchema = z.object({
	email: z.email(),
});

export const joinWaitlist = createServerFn({ method: "POST" })
	.inputValidator((data) => waitlistSchema.parse(data))
	.handler(async ({ data }): Promise<{ success: boolean; error?: string }> => {
		const supabase = createAdminSupabaseClient();

		// Store normalized so waitlist eligibility (which matches account.email
		// on lower(btrim(...))) and the normalized unique index agree on identity.
		const email = data.email.trim().toLowerCase();

		const { error } = await supabase.from("waitlist").insert({ email });

		if (error) {
			// Duplicate email — treat as success (don't leak signup status)
			if (error.code === "23505") {
				return { success: true };
			}
			captureServerError(error, {
				area: "waitlist",
				operation: "join_waitlist",
				extra: { stage: "insert" },
			});
			console.error("[waitlist] insert failed:", error.message);
			return { success: false, error: "Something went wrong. Try again." };
		}

		await sendWaitlistConfirmation(email).catch((err: unknown) => {
			captureServerError(err, {
				area: "waitlist",
				operation: "join_waitlist",
				extra: { stage: "confirmation_email" },
			});
			console.error("[waitlist] email failed:", err);
		});

		return { success: true };
	});
