/**
 * Extracts a human-readable message from an unknown thrown value.
 *
 * `catch` binds `unknown`, so a thrown value may be an Error, a string, or
 * anything else. This narrows it to the Error message when possible and
 * stringifies otherwise.
 */
export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
