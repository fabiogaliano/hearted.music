/**
 * Zod schemas for PlaylistMatchFiltersV1.
 *
 * Two parsers with intentionally distinct names to prevent accidental misuse:
 *
 * - `parseSaveMatchFilters`: STRICT — rejects unknown keys, used before writes.
 *   Returns a `Result` so callers branch on validity without try/catch.
 * - `parseStoredMatchFilters`: FORGIVING — ignores unknown stored keys, but any
 *   known field with invalid data normalizes the entire object to `{ version: 1 }`.
 *   It can't fail, so it returns the value plus a `wasNormalized` flag directly.
 */

import { Result } from "better-result";
import { z } from "zod";
import { isValidDateOnly } from "./dates";
import { isLanguageCatalogCode } from "./languages";
import type { PlaylistMatchFiltersV1 } from "./types";

const YEAR_MIN = 1000;
const YEAR_MAX = 9999;

// Strict: rejects malformed strings AND well-formed-but-impossible dates like
// 2024-02-31, which a regex alone would accept (see ./dates).
const dateOnlyString = z
	.string()
	.refine(isValidDateOnly, "Must be a real YYYY-MM-DD calendar date");

const releaseYearValue = z.number().int().min(YEAR_MIN).max(YEAR_MAX);

// On the save (strict) path every nested object also rejects unknown keys, so a
// stray field like `releaseYear.label` is a hard error rather than silently
// stripped — "save-time validation rejects unknown keys" must hold at every
// depth, not just the top level. The stored (forgiving) path keeps the default
// strip behavior so unknown keys from future schema versions are ignored.
function objectShape<Shape extends z.ZodRawShape>(
	shape: Shape,
	strict: boolean,
) {
	return strict ? z.object(shape).strict() : z.object(shape);
}

function releaseYearSchema(strict: boolean) {
	return z.discriminatedUnion("kind", [
		objectShape({ kind: z.literal("exact"), year: releaseYearValue }, strict),
		objectShape({ kind: z.literal("before"), end: releaseYearValue }, strict),
		objectShape({ kind: z.literal("after"), start: releaseYearValue }, strict),
		objectShape(
			{
				kind: z.literal("range"),
				start: releaseYearValue,
				end: releaseYearValue,
			},
			strict,
		).refine((v) => v.start <= v.end, {
			message: "range.start must be <= range.end",
		}),
	]);
}

function likedAtEndSchema(strict: boolean) {
	return z.discriminatedUnion("kind", [
		objectShape({ kind: z.literal("date"), date: dateOnlyString }, strict),
		objectShape({ kind: z.literal("today") }, strict),
	]);
}

function likedAtSchema(strict: boolean) {
	return z.discriminatedUnion("kind", [
		objectShape({ kind: z.literal("before"), endDate: dateOnlyString }, strict),
		objectShape(
			{ kind: z.literal("after"), startDate: dateOnlyString },
			strict,
		),
		objectShape(
			{
				kind: z.literal("range"),
				startDate: dateOnlyString,
				end: likedAtEndSchema(strict),
			},
			strict,
		).refine(
			(v) => {
				if (v.end.kind !== "date") return true;
				return v.startDate <= v.end.date;
			},
			{ message: "range end date must be on/after startDate" },
		),
	]);
}

function languageCodesSchema(strict: boolean) {
	const base = objectShape({ codes: z.array(z.string()) }, strict);

	return base.refine(
		(v) => v.codes.length > 0 && v.codes.every((c) => isLanguageCatalogCode(c)),
		{
			message:
				"languages.codes must be non-empty and all codes must be in catalog",
		},
	);
}

function coreFields(strict: boolean) {
	return {
		version: z.literal(1),
		releaseYear: releaseYearSchema(strict).optional(),
		likedAt: likedAtSchema(strict).optional(),
		vocalGender: z.enum(["female", "male"]).optional(),
	};
}

/** Strict schema — rejects unknown keys at every depth, used for save validation. */
const saveSchema = z
	.object({
		...coreFields(true),
		languages: languageCodesSchema(true).optional(),
	})
	.strict();

/** Passthrough schema — ignores unknown stored keys, used for read-path parsing. */
const storedSchema = z.object({
	...coreFields(false),
	languages: languageCodesSchema(false).optional(),
});

const DEFAULT_FILTERS: PlaylistMatchFiltersV1 = { version: 1 };

/**
 * Parse and validate a value intended for write.
 * Rejects unknown keys so accidental extra fields from callers are caught.
 */
export function parseSaveMatchFilters(
	raw: unknown,
): Result<PlaylistMatchFiltersV1, string> {
	const result = saveSchema.safeParse(raw);
	if (!result.success) {
		return Result.err(result.error.message);
	}
	return Result.ok(result.data satisfies PlaylistMatchFiltersV1);
}

/**
 * Parse a value loaded from storage.
 * Unknown stored keys are silently ignored, but if any KNOWN field has invalid
 * data the whole object normalizes to `{ version: 1 }`.
 *
 * `wasNormalized: true` signals that a known field was invalid and the object
 * was reset to the default — callers MUST log an internal warning when this is true
 * (per Decisions §6).
 */
export function parseStoredMatchFilters(raw: unknown): {
	value: PlaylistMatchFiltersV1;
	wasNormalized: boolean;
} {
	const result = storedSchema.safeParse(raw);
	if (!result.success) {
		return { value: DEFAULT_FILTERS, wasNormalized: true };
	}
	return {
		value: result.data satisfies PlaylistMatchFiltersV1,
		wasNormalized: false,
	};
}
