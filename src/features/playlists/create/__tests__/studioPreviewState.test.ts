import { describe, expect, it } from "vitest";
import { getStudioPreviewState } from "../studioPreviewState";

describe("getStudioPreviewState", () => {
	it("uses the committed max when deciding whether more matching songs exist", () => {
		expect(
			getStudioPreviewState({
				totalEligible: 8,
				tracklistLength: 8,
				committedMaxSongs: 15,
				isLoading: false,
			}).showNotEnoughNote,
		).toBe(true);
	});

	it("suppresses the note when filter-exempt pins fill the committed tracklist", () => {
		expect(
			getStudioPreviewState({
				totalEligible: 8,
				tracklistLength: 15,
				committedMaxSongs: 15,
				isLoading: false,
			}).showNotEnoughNote,
		).toBe(false);
	});

	it("distinguishes a warming empty preview from a settled empty preview", () => {
		expect(
			getStudioPreviewState({
				totalEligible: 0,
				tracklistLength: 0,
				committedMaxSongs: 15,
				isLoading: true,
			}),
		).toMatchObject({ tracklistIsEmpty: true, isWarming: true });

		expect(
			getStudioPreviewState({
				totalEligible: 0,
				tracklistLength: 0,
				committedMaxSongs: 15,
				isLoading: false,
			}),
		).toMatchObject({ tracklistIsEmpty: true, isWarming: false });
	});
});
