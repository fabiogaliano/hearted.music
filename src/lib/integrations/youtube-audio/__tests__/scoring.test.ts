import { describe, expect, it } from "vitest";
import {
	scoreCandidate,
	scoreCandidates,
	stripVersionQualifier,
} from "../scoring";
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

const THRESHOLDS = { minScore: 0.75 };

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

	it("selects the top-ranked candidate when two are equally good (no gap bail)", () => {
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
		// Both score the same; ties resolve to search order (the first), not manual.
		expect(decision.kind).toBe("selected");
		if (decision.kind === "selected")
			expect(decision.candidate.videoId).toBe("a");
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

	it("selects a remaster-named song against a plain YouTube upload", () => {
		// The DB name carries a "- Remastered" tag the upload omits; without the
		// qualifier strip the missing token drops title match below the floor.
		const decision = scoreCandidates(
			{ ...SONG, name: "Blinding Lights - Remastered 2020" },
			[
				candidate({
					videoId: "rm",
					title: "The Weeknd - Blinding Lights",
					channel: "The Weeknd - Topic",
					durationSeconds: 201,
				}),
			],
			THRESHOLDS,
		);
		expect(decision.kind).toBe("selected");
		if (decision.kind === "selected")
			expect(decision.candidate.videoId).toBe("rm");
	});
});

describe("stripVersionQualifier", () => {
	it.each([
		["Some Might Say - Remastered", "Some Might Say"],
		["Sakura - 2023 Remaster", "Sakura"],
		["Boys Don't Cry - Single Version", "Boys Don't Cry"],
		["Missing - 2013 Remaster", "Missing"],
	])("strips same-recording qualifier from %s", (input, expected) => {
		expect(stripVersionQualifier(input)).toBe(expected);
	});

	it.each([
		"Tequila - En Vivo",
		"Plain Title",
		"Title - With A Dash Subtitle",
	])("leaves %s untouched (not a same-recording qualifier)", (input) => {
		expect(stripVersionQualifier(input)).toBe(input);
	});
});
