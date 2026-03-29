/**
 * Dev-only artificial delay at stage boundaries.
 * No-ops in production or when delayMs is 0.
 */

export async function maybeDevDelay(
	delayMs: number | undefined,
): Promise<void> {
	if (!delayMs || delayMs <= 0) return;
	if (process.env.NODE_ENV === "production") return;
	await new Promise((resolve) => setTimeout(resolve, delayMs));
}
