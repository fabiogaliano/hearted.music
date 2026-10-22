/**
 * The studio's preview surface has exactly one state at a time. Deriving it
 * once here, from the query flags and the committed snapshot, is what keeps a
 * failed request from rendering as "nothing matches your filters" (which is
 * what happened on 2026-10-21 when the preview call was killed server-side and
 * the screen only knew `isLoading`).
 */

export type StudioPreviewState =
	/** No tracklist to show yet and a fetch for it is in flight. */
	| { kind: "loading" }
	/** The preview request failed; nothing trustworthy to show. */
	| { kind: "failed"; retry: () => void }
	/** Settled with no songs. */
	| { kind: "empty"; eligibleShortfall: number | null }
	/** Songs on screen; `isRefreshing` while they belong to a previous config. */
	| { kind: "ready"; isRefreshing: boolean; eligibleShortfall: number | null };

export interface StudioPreviewStateInput {
	query: {
		isError: boolean;
		isLoading: boolean;
		/** The shown data belongs to a previous query key (keepPreviousData). */
		isPlaceholderData: boolean;
	};
	tracklistLength: number;
	totalEligible: number;
	/**
	 * The max that produced the tracklist, never the live slider value: while
	 * a debounce is in flight the rows still belong to the previous config.
	 */
	committedMaxSongs: number;
	retry: () => void;
}

/**
 * How many songs matched when that is fewer than the user asked for, else
 * null. Filter-exempt pins can fill the tracklist past the eligible count, in
 * which case there is nothing to note. Never computed over placeholder rows.
 */
function eligibleShortfall({
	totalEligible,
	tracklistLength,
	committedMaxSongs,
}: Pick<
	StudioPreviewStateInput,
	"totalEligible" | "tracklistLength" | "committedMaxSongs"
>): number | null {
	const fewerThanAsked =
		totalEligible > 0 &&
		totalEligible < committedMaxSongs &&
		tracklistLength < committedMaxSongs;
	return fewerThanAsked ? totalEligible : null;
}

export function deriveStudioPreviewState(
	input: StudioPreviewStateInput,
): StudioPreviewState {
	const { query, tracklistLength, retry } = input;
	const fetching = query.isLoading || query.isPlaceholderData;

	if (query.isError) return { kind: "failed", retry };

	if (tracklistLength === 0) {
		if (fetching) return { kind: "loading" };
		return { kind: "empty", eligibleShortfall: eligibleShortfall(input) };
	}

	return {
		kind: "ready",
		isRefreshing: query.isPlaceholderData,
		eligibleShortfall: fetching ? null : eligibleShortfall(input),
	};
}
