const ONBOARDING_SIZES = [1, 5, 10, 25, 50] as const;
const STEADY_STATE_SIZE = 50;

export function getChunkSize(batchSequence: number): number {
	if (batchSequence < ONBOARDING_SIZES.length) {
		return ONBOARDING_SIZES[batchSequence];
	}
	return STEADY_STATE_SIZE;
}
