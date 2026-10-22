import { describe, expect, it } from "vitest";
import {
	deriveStudioPreviewState,
	type StudioPreviewStateInput,
} from "../studioPreviewState";

const retry = () => {};

function derive(overrides: Partial<StudioPreviewStateInput> = {}) {
	return deriveStudioPreviewState({
		query: { isError: false, isLoading: false, isPlaceholderData: false },
		tracklistLength: 0,
		totalEligible: 0,
		committedMaxSongs: 15,
		retry,
		...overrides,
	});
}

describe("deriveStudioPreviewState", () => {
	// Regression: 2026-10-21 the preview call was killed server-side and the
	// studio rendered "Nothing matches", blaming the user's filters.
	it("reports a failed request as failed, never as an empty library", () => {
		expect(
			derive({
				query: { isError: true, isLoading: false, isPlaceholderData: false },
			}),
		).toEqual({ kind: "failed", retry });
	});

	it("distinguishes a warming empty preview from a settled empty preview", () => {
		expect(
			derive({
				query: { isError: false, isLoading: true, isPlaceholderData: false },
			}).kind,
		).toBe("loading");

		expect(derive().kind).toBe("empty");
	});

	it("reports the eligible shortfall against the committed max, not the live slider", () => {
		expect(derive({ totalEligible: 8, tracklistLength: 8 })).toEqual({
			kind: "ready",
			isRefreshing: false,
			eligibleShortfall: 8,
		});
	});

	it("suppresses the shortfall when filter-exempt pins fill the committed tracklist", () => {
		expect(derive({ totalEligible: 8, tracklistLength: 15 })).toMatchObject({
			kind: "ready",
			eligibleShortfall: null,
		});
	});

	it("never computes a shortfall over placeholder rows from a previous config", () => {
		expect(
			derive({
				query: { isError: false, isLoading: false, isPlaceholderData: true },
				totalEligible: 8,
				tracklistLength: 8,
			}),
		).toEqual({ kind: "ready", isRefreshing: true, eligibleShortfall: null });
	});
});
