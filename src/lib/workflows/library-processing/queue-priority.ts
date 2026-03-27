export type QueueBand = "low" | "standard" | "priority";

const BAND_VALUES: Record<QueueBand, number> = {
	low: 0,
	standard: 50,
	priority: 100,
};

export function bandToNumeric(band: QueueBand): number {
	return BAND_VALUES[band];
}

/**
 * Resolves the queue priority band for an account.
 * Hides entitlement lookup behind a thin boundary.
 * Defaults to "low" until billing/entitlement data exists.
 */
export async function resolveQueuePriority(
	_accountId: string,
): Promise<QueueBand> {
	// No entitlement table yet — default to free/baseline band
	return "low";
}
