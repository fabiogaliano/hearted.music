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

const waitlistSchema = z.object({
	email: z.email(),
});

export const joinWaitlist = createServerFn({ method: "POST" })
	.inputValidator((data) => waitlistSchema.parse(data))
	.handler(async ({ data }): Promise<{ success: boolean; error?: string }> => {
		const { email } = data;
		const supabase = createAdminSupabaseClient();

		const { error } = await supabase.from("waitlist").insert({ email });

		if (error) {
			// Duplicate email — treat as success (don't leak signup status)
			if (error.code === "23505") {
				return { success: true };
			}
			console.error("[waitlist] insert failed:", error.message);
			return { success: false, error: "Something went wrong. Try again." };
		}

		await sendWaitlistConfirmation(email).catch((err: unknown) =>
			console.error("[waitlist] email failed:", err),
		);

		return { success: true };
	});
