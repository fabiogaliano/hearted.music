/**
 * Server functions for the settings page.
 *
 * Theme update reuses the existing preferences query.
 * Account data comes from the auth context.
 */

import { createServerFn } from "@tanstack/react-start";
import { Result } from "better-result";
import { updateTheme } from "@/lib/domains/library/accounts/preferences-queries";
import { requireAuthSession } from "@/lib/platform/auth/auth.server";
import { themeSchema } from "@/lib/theme/types";
import { z } from "zod";

const updateThemeInput = z.object({
	theme: themeSchema,
});

/**
 * Updates the user's theme preference.
 * Shares the same DB operation as onboarding's saveThemePreference,
 * but scoped to settings for clean imports.
 */
export const updateThemePreference = createServerFn({ method: "POST" })
	.inputValidator(updateThemeInput)
	.handler(async ({ data }): Promise<{ success: true }> => {
		const { session } = await requireAuthSession();

		const result = await updateTheme(session.accountId, data.theme);

		if (Result.isError(result)) {
			throw new Error("Failed to save theme preference");
		}

		return { success: true };
	});
