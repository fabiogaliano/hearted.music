/**
 * Server functions for the settings page.
 *
 * Theme update reuses the existing preferences query.
 * Account data comes from the auth context.
 */

import { createServerFn } from "@tanstack/react-start";
import { Result } from "better-result";
import { z } from "zod";
import {
	getOrCreatePreferences,
	updateMatchStrictness,
	updateTheme,
} from "@/lib/domains/library/accounts/preferences-queries";
import {
	DEFAULT_MATCH_STRICTNESS,
	MATCH_STRICTNESS_VALUES,
	type MatchStrictness,
} from "@/lib/domains/taste/song-matching/strictness";
import { authMiddleware } from "@/lib/platform/auth/auth.middleware";
import { themeSchema } from "@/lib/theme/types";

const updateThemeInput = z.object({
	theme: themeSchema,
});

const updateMatchStrictnessInput = z.object({
	strictness: z.enum(MATCH_STRICTNESS_VALUES),
});

/**
 * Updates the user's theme preference.
 * Shares the same DB operation as onboarding's saveThemePreference,
 * but scoped to settings for clean imports.
 */
export const updateThemePreference = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator(updateThemeInput)
	.handler(async ({ data, context }): Promise<{ success: true }> => {
		const result = await updateTheme(context.session.accountId, data.theme);

		if (Result.isError(result)) {
			throw new Error("Failed to save theme preference");
		}

		return { success: true };
	});

/**
 * Reads the account's match-strictness preset for the settings route loader.
 * Falls back to the default on a missing/error row — the picker always renders
 * a selected option.
 */
export const getMatchStrictnessPreference = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.handler(async ({ context }): Promise<MatchStrictness> => {
		const prefs = await getOrCreatePreferences(context.session.accountId);
		if (Result.isError(prefs)) {
			return DEFAULT_MATCH_STRICTNESS;
		}

		const stored = prefs.value.match_strictness as MatchStrictness;
		return MATCH_STRICTNESS_VALUES.includes(stored)
			? stored
			: DEFAULT_MATCH_STRICTNESS;
	});

/**
 * Updates the account's match-strictness preset. Server-side validation is the
 * trust boundary — never the radio group.
 */
export const updateMatchStrictnessPreference = createServerFn({
	method: "POST",
})
	.middleware([authMiddleware])
	.inputValidator(updateMatchStrictnessInput)
	.handler(async ({ data, context }): Promise<{ success: true }> => {
		const result = await updateMatchStrictness(
			context.session.accountId,
			data.strictness,
		);

		if (Result.isError(result)) {
			throw new Error("Failed to save match strictness preference");
		}

		return { success: true };
	});
