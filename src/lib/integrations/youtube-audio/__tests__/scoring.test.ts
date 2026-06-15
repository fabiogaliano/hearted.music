import { describe, expect, it } from "vitest";
import { scoreCandidate, scoreCandidates } from "../scoring";
import type { SongForScoring, YoutubeCandidate } from "../types";

const SONG: SongForScoring = {
	name: "Blinding Lights",
	artists: ["The Weeknd"],
	albumName: "After Hours",
	durationMs: 200_000,
	spotifyId: "sp",
};

function candidate(p: Partial<YoutubeCandidate>): YoutubeCandidate {
	return {
		videoId: p.videoId ?? "id",
		url: p.url ?? "https://youtu.be/id",
		title: p.title ?? "",
		channel: p.channel ?? null,
		durationSeconds: p.durationSeconds ?? null,
		thumbnailUrl: p.thumbnailUrl ?? null,
	};
}

const THRESHOLDS = { minScore: 0.82, minScoreGap: 0.08 };

describe("scoreCandidates", () => {
	it("selects an exact official audio match", () => {
		const decision = scoreCandidates(
			SONG,
			[
				candidate({
					videoId: "good",
					title: "The Weeknd - Blinding Lights (Official Audio)",
					channel: "The Weeknd - Topic",
					durationSeconds: 201,
				}),
			],
			THRESHOLDS,
		);
		expect(decision.kind).toBe("selected");
		if (decision.kind === "selected") {
			expect(decision.candidate.videoId).toBe("good");
			expect(decision.score).toBeGreaterThanOrEqual(0.82);
		}
	});

	it.each([
		"live",
		"remix",
		"cover",
		"sped up",
		"slowed",
		"nightcore",
	])("hard-rejects a '%s' variant", (marker) => {
		const scored = scoreCandidate(
			SONG,
			candidate({
				title: `The Weeknd - Blinding Lights (${marker})`,
				channel: "The Weeknd - Topic",
				durationSeconds: 201,
			}),
		);
		expect(scored.rejected).toBe(true);
	});

	it("does not reject 'discover' as 'cover' (word boundary)", () => {
		const scored = scoreCandidate(
			{ ...SONG, name: "Discover" },
			candidate({ title: "The Weeknd - Discover", durationSeconds: 201 }),
		);
		expect(scored.rejected).toBe(false);
	});

	it("rejects a candidate whose duration is off by more than 25s", () => {
		const scored = scoreCandidate(
			SONG,
			candidate({
				title: "Blinding Lights",
				channel: "random uploader",
				durationSeconds: 320,
			}),
		);
		expect(scored.rejected).toBe(true);
		expect(scored.rejectReason).toMatch(/duration off/);
	});

	it("falls back to manual_needed when the top two are within the gap", () => {
		const decision = scoreCandidates(
			SONG,
			[
				candidate({
					videoId: "a",
					title: "The Weeknd - Blinding Lights",
					channel: "Fan Uploads",
					durationSeconds: 201,
				}),
				candidate({
					videoId: "b",
					title: "The Weeknd - Blinding Lights",
					channel: "Other Uploads",
					durationSeconds: 200,
				}),
			],
			THRESHOLDS,
		);
		expect(decision.kind).toBe("manual_needed");
	});

	it("returns manual_needed when there are no candidates", () => {
		const decision = scoreCandidates(SONG, [], THRESHOLDS);
		expect(decision.kind).toBe("manual_needed");
	});

	it("penalizes (lower score) a missing-artist title vs. a full match", () => {
		const withArtist = scoreCandidate(
			SONG,
			candidate({
				title: "The Weeknd - Blinding Lights",
				durationSeconds: 201,
			}),
		);
		const titleOnly = scoreCandidate(
			SONG,
			candidate({ title: "Blinding Lights", durationSeconds: 201 }),
		);
		expect(withArtist.score).toBeGreaterThan(titleOnly.score);
	});
});
