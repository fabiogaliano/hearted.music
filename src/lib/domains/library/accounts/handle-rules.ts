export const HANDLE_FORMAT_VALIDATION_REASONS = [
	"empty",
	"too_long",
	"contains_at_sign",
	"invalid_chars",
	"leading_period",
	"trailing_period",
	"consecutive_periods",
] as const;

export const HANDLE_VALIDATION_REASONS = [
	...HANDLE_FORMAT_VALIDATION_REASONS,
	"reserved",
	"profanity",
	"taken",
] as const;

export type HandleFormatValidationReason =
	(typeof HANDLE_FORMAT_VALIDATION_REASONS)[number];

export type HandleValidationReason = (typeof HANDLE_VALIDATION_REASONS)[number];

export type HandleFormatValidationResult =
	| { status: "valid"; normalizedHandle: string }
	| { status: "invalid"; reason: HandleFormatValidationReason };

export function validateHandleFormatInput(
	raw: string,
): HandleFormatValidationResult {
	const normalized = raw.toLowerCase();

	if (normalized.length === 0) {
		return { status: "invalid", reason: "empty" };
	}

	if (normalized.length > 30) {
		return { status: "invalid", reason: "too_long" };
	}

	if (normalized.includes("@")) {
		return { status: "invalid", reason: "contains_at_sign" };
	}

	if (!/^[a-z0-9._]+$/.test(normalized)) {
		return { status: "invalid", reason: "invalid_chars" };
	}

	if (normalized.startsWith(".")) {
		return { status: "invalid", reason: "leading_period" };
	}

	if (normalized.includes("..")) {
		return { status: "invalid", reason: "consecutive_periods" };
	}

	if (normalized.endsWith(".")) {
		return { status: "invalid", reason: "trailing_period" };
	}

	return { status: "valid", normalizedHandle: normalized };
}

// Exact reserved-handle set per §5.5. Entries using hyphens (e.g. "liked-songs")
// are unreachable under v0 syntax but are included so protection is in place if
// syntax broadens later.
const RESERVED_HANDLES = new Set([
	// Base set
	"admin",
	"support",
	"help",
	"about",
	"official",
	"hearted",
	"team",
	"staff",
	"null",
	"undefined",

	// Protected app-language / public-surface set
	"liked-songs",
	"jukebox",
	"settings",
	"login",
	"faq",
	"privacy",
	"terms",
	"forgot-password",
	"reset-password",
	"verify-email",

	// Official-ish set
	"verified",
	"moderator",
	"founder",
	"press",
	"security",
	"legal",
	"billing",
	"contact",
]);

export function isReservedHandle(normalizedHandle: string): boolean {
	return RESERVED_HANDLES.has(normalizedHandle.toLowerCase());
}
