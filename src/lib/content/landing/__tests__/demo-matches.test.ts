import { describe, expect, it } from "vitest";
import {
	getDemoMatchesForFlaggedPlaylists,
	getDemoMatchesForSong,
} from "../demo-matches";

// Olivia Rodrigo — drivers license. Curated to playlists 1 (0.97), 3 (0.80),
// 5 (0.60) in DEMO_SONG_MATCHES.
const DRIVERS_LICENSE = "7lPN2DXiMsVn7XUKtOW1CS";

// Synthesized fallback band for pairs the curated table doesn't cover.
const SYNTH_MIN = 0.12;
const SYNTH_MAX = 0.41;

describe("getDemoMatchesForFlaggedPlaylists", () => {
	it("falls back to the song's curated matches when nothing is flagged", () => {
		expect(getDemoMatchesForFlaggedPlaylists(DRIVERS_LICENSE, [])).toEqual(
			getDemoMatchesForSong(DRIVERS_LICENSE),
		);
	});

	it("uses curated scores for flagged playlists that have one", () => {
		const result = getDemoMatchesForFlaggedPlaylists(DRIVERS_LICENSE, [
			"1",
			"3",
			"5",
		]);
		expect(result.map((m) => [m.id, m.matchScore])).toEqual([
			["1", 0.97],
			["3", 0.8],
			["5", 0.6],
		]);
	});

	it("synthesizes a low (but stable) score for uncovered flagged playlists", () => {
		// drivers license has no curated score for 2/4/7.
		const flagged = ["2", "4", "7"];
		const result = getDemoMatchesForFlaggedPlaylists(DRIVERS_LICENSE, flagged);

		expect(result).toHaveLength(3);
		for (const match of result) {
			expect(match.matchScore).toBeGreaterThanOrEqual(SYNTH_MIN);
			expect(match.matchScore).toBeLessThanOrEqual(SYNTH_MAX);
		}
		// Deterministic: same inputs → identical scores.
		expect(getDemoMatchesForFlaggedPlaylists(DRIVERS_LICENSE, flagged)).toEqual(
			result,
		);
	});

	it("always returns exactly the flagged playlists, sorted by score desc", () => {
		const result = getDemoMatchesForFlaggedPlaylists(DRIVERS_LICENSE, [
			"2", // synthesized (low)
			"1", // curated 0.97
			"7", // synthesized (low)
		]);

		expect(result.map((m) => m.id).sort()).toEqual(["1", "2", "7"]);
		// Curated high score sorts above the synthesized ones.
		expect(result[0]?.id).toBe("1");
		const scores = result.map((m) => m.matchScore);
		expect(scores).toEqual([...scores].sort((a, b) => b - a));
	});

	it("drops flagged ids that are not real demo playlists", () => {
		const result = getDemoMatchesForFlaggedPlaylists(DRIVERS_LICENSE, [
			"1",
			"does-not-exist",
		]);
		expect(result.map((m) => m.id)).toEqual(["1"]);
	});

	it("carries the playlist name and reason blurb through", () => {
		const [match] = getDemoMatchesForFlaggedPlaylists(DRIVERS_LICENSE, ["1"]);
		expect(match?.name).toBe("crying in the car");
		expect(match?.reason).not.toBe("");
	});
});
