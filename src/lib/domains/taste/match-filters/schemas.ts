/**
 * Zod schemas for PlaylistMatchFiltersV1.
 *
 * Two parsers with intentionally distinct names to prevent accidental misuse:
 *
 * - `parseSaveMatchFilters`: STRICT — rejects unknown keys, used before writes.
 * - `parseStoredMatchFilters`: FORGIVING — ignores unknown stored keys, but any
 *   known field with invalid data normalizes the entire object to `{ version: 1 }`.
 *
 * Both return a typed ParseResult rather than throwing so callers can branch on
 * success/failure without try/catch.
 */

import { z } from "zod";
import { isLanguageCatalogCode } from "./languages";
import type {
	ParseResult,
	PlaylistMatchFiltersV1,
	StoredParseResult,
} from "./types";

const YEAR_MIN = 1000;
const YEAR_MAX = 9999;

const dateOnlyString = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, "Must be a YYYY-MM-DD date string");

const releaseYearValue = z.number().int().min(YEAR_MIN).max(YEAR_MAX);

const releaseYearSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("exact"), year: releaseYearValue }),
	z.object({ kind: z.literal("before"), end: releaseYearValue }),
	z.object({ kind: z.literal("after"), start: releaseYearValue }),
	z
		.object({
			kind: z.literal("range"),
			start: releaseYearValue,
			end: releaseYearValue,
		})
		.refine((v) => v.start <= v.end, {
			message: "range.start must be <= range.end",
		}),
]);

const likedAtEndSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("date"), date: dateOnlyString }),
	z.object({ kind: z.literal("today") }),
]);

const likedAtSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("before"), endDate: dateOnlyString }),
	z.object({ kind: z.literal("after"), startDate: dateOnlyString }),
	z
		.object({
			kind: z.literal("range"),
			startDate: dateOnlyString,
			end: likedAtEndSchema,
		})
		.refine(
			(v) => {
				if (v.end.kind !== "date") return true;
				return v.startDate <= v.end.date;
			},
			{ message: "range end date must be on/after startDate" },
		),
]);

function languageCodesSchema(strict: boolean) {
	const base = strict
		? z.object({ codes: z.array(z.string()) }).strict()
		: z.object({ codes: z.array(z.string()) });

	return base.refine(
		(v) => v.codes.length > 0 && v.codes.every((c) => isLanguageCatalogCode(c)),
		{
			message:
				"languages.codes must be non-empty and all codes must be in catalog",
		},
	);
}

const coreFields = {
	version: z.literal(1),
	releaseYear: releaseYearSchema.optional(),
	likedAt: likedAtSchema.optional(),
	vocalGender: z.enum(["female", "male"]).optional(),
};

/** Strict schema — rejects unknown keys, used for save-path validation. */
const saveSchema = z
	.object({
		...coreFields,
		languages: languageCodesSchema(true).optional(),
	})
	.strict();

/** Passthrough schema — ignores unknown stored keys, used for read-path parsing. */
const storedSchema = z.object({
	...coreFields,
	languages: languageCodesSchema(false).optional(),
});

const DEFAULT_FILTERS: PlaylistMatchFiltersV1 = { version: 1 };

/**
 * Parse and validate a value intended for write.
 * Rejects unknown keys so accidental extra fields from callers are caught.
 */
export function parseSaveMatchFilters(
	raw: unknown,
): ParseResult<PlaylistMatchFiltersV1> {
	const result = saveSchema.safeParse(raw);
	if (!result.success) {
		return { ok: false, error: result.error.message };
	}
	return { ok: true, value: result.data satisfies PlaylistMatchFiltersV1 };
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
export function parseStoredMatchFilters(
	raw: unknown,
): StoredParseResult<PlaylistMatchFiltersV1> {
	const result = storedSchema.safeParse(raw);
	if (!result.success) {
		return { ok: true, value: DEFAULT_FILTERS, wasNormalized: true };
	}
	return {
		ok: true,
		value: result.data satisfies PlaylistMatchFiltersV1,
		wasNormalized: false,
	};
}
