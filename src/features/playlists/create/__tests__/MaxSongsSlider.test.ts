import { describe, expect, it } from "vitest";
import {
	approximateDuration,
	clampAndStep,
	MAX_SONGS_MAX,
	MAX_SONGS_MIN,
	MAX_SONGS_STEP,
} from "../MaxSongsSlider";

describe("clampAndStep", () => {
	it("returns the value unchanged when already valid", () => {
		expect(clampAndStep(15, MAX_SONGS_MIN, MAX_SONGS_MAX, MAX_SONGS_STEP)).toBe(
			15,
		);
	});

	it("clamps to min when value is below range", () => {
		expect(clampAndStep(1, MAX_SONGS_MIN, MAX_SONGS_MAX, MAX_SONGS_STEP)).toBe(
			MAX_SONGS_MIN,
		);
	});

	it("clamps to max when value is above range", () => {
		expect(clampAndStep(99, MAX_SONGS_MIN, MAX_SONGS_MAX, MAX_SONGS_STEP)).toBe(
			MAX_SONGS_MAX,
		);
	});

	it("snaps to the nearest step", () => {
		// 13 is between 10 and 15 — rounds to 15 (nearer)
		expect(clampAndStep(13, MAX_SONGS_MIN, MAX_SONGS_MAX, MAX_SONGS_STEP)).toBe(
			15,
		);
		// 11 is between 10 and 15 — rounds to 10 (nearer)
		expect(clampAndStep(11, MAX_SONGS_MIN, MAX_SONGS_MAX, MAX_SONGS_STEP)).toBe(
			10,
		);
	});

	it("handles the exact min boundary", () => {
		expect(
			clampAndStep(MAX_SONGS_MIN, MAX_SONGS_MIN, MAX_SONGS_MAX, MAX_SONGS_STEP),
		).toBe(MAX_SONGS_MIN);
	});

	it("handles the exact max boundary", () => {
		expect(
			clampAndStep(MAX_SONGS_MAX, MAX_SONGS_MIN, MAX_SONGS_MAX, MAX_SONGS_STEP),
		).toBe(MAX_SONGS_MAX);
	});

	it("returns min for a value of zero", () => {
		expect(clampAndStep(0, MAX_SONGS_MIN, MAX_SONGS_MAX, MAX_SONGS_STEP)).toBe(
			MAX_SONGS_MIN,
		);
	});
});

describe("approximateDuration", () => {
	it("returns approximate duration for the default 15 songs", () => {
		// 15 × 3.3 = 49.5 → rounds to 50
		expect(approximateDuration(15)).toBe("about 50 minutes");
	});

	it("returns approximate duration for 5 songs", () => {
		// 5 × 3.3 = 16.5 → rounds to 17
		expect(approximateDuration(5)).toBe("about 17 minutes");
	});

	it("returns approximate duration for max 50 songs", () => {
		// 50 × 3.3 = 165 → 165
		expect(approximateDuration(50)).toBe("about 165 minutes");
	});
});
