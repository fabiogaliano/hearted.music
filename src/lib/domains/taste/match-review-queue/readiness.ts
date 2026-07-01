import { Result } from "better-result";
import type { DbError } from "@/lib/shared/errors/database";

export { hasFirstVisibleReviewSubject } from "./service";

/**
 * UI must not falsely claim ready when DB state is unknown
 */
export function resolveReadinessConservative(
	result: Result<boolean, DbError>,
): boolean {
	if (Result.isError(result)) return false;
	return result.value;
}

/**
 * Assume ready on transient DB failures to avoid spamming bootstrap selection or interactive priority bumps
 */
export function resolveReadinessPermissive(
	result: Result<boolean, DbError>,
): boolean {
	if (Result.isError(result)) return true;
	return result.value;
}
