export interface StudioPreviewStateInput {
	totalEligible: number;
	tracklistLength: number;
	committedMaxSongs: number;
	isLoading: boolean;
}

export interface StudioPreviewState {
	tracklistIsEmpty: boolean;
	isWarming: boolean;
	showNotEnoughNote: boolean;
}

/** Derive studio messaging from the same committed snapshot as the tracklist. */
export function getStudioPreviewState({
	totalEligible,
	tracklistLength,
	committedMaxSongs,
	isLoading,
}: StudioPreviewStateInput): StudioPreviewState {
	const tracklistIsEmpty = tracklistLength === 0;

	return {
		tracklistIsEmpty,
		isWarming: tracklistIsEmpty && isLoading,
		showNotEnoughNote:
			totalEligible > 0 &&
			totalEligible < committedMaxSongs &&
			tracklistLength < committedMaxSongs &&
			!isLoading,
	};
}
