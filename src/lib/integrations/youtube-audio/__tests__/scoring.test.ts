import { describe, expect, it } from "vitest";
import {
	SCORING_VERSION,
	scoreCandidate,
	scoreCandidates,
	stripVersionQualifier,
	toCandidateSnapshots,
} from "../scoring";
import type {
	ScoredCandidate,
	SongForScoring,
	YoutubeCandidate,
} from "../types";

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

	it("hard-rejects a styled-Unicode 'slowed' variant (NFKD fold)", () => {
		// Uploaders dodge the reject phrases by spelling them in math-bold glyphs;
		// NFKD normalization folds them back to ASCII so the marker still trips.
		const scored = scoreCandidate(
			SONG,
			candidate({
				title: "The Weeknd - Blinding Lights (𝙨𝙡𝙤𝙬𝙚𝙙 + 𝙧𝙚𝙫𝙚𝙧𝙗)",
				channel: "random uploader",
				durationSeconds: 201,
			}),
		);
		expect(scored.rejected).toBe(true);
		expect(scored.rejectReason).toMatch(/slowed/);
	});

	it("does not reject 'discover' as 'cover' (word boundary)", () => {
		const scored = scoreCandidate(
			{ ...SONG, name: "Discover" },
			candidate({ title: "The Weeknd - Discover", durationSeconds: 201 }),
		);
		expect(scored.rejected).toBe(false);
	});

	it("keeps a marker the song itself carries (a remix song matches a remix)", () => {
		const scored = scoreCandidate(
			{ ...SONG, name: "Blinding Lights (Chromatics Remix)" },
			candidate({
				title: "The Weeknd - Blinding Lights (Chromatics Remix)",
				channel: "The Weeknd - Topic",
				durationSeconds: 201,
			}),
		);
		expect(scored.rejected).toBe(false);
	});

	it("keeps a reject phrase that is a credited artist name", () => {
		const scored = scoreCandidate(
			{ ...SONG, artists: ["Cover Drive"] },
			candidate({
				title: "Cover Drive - Blinding Lights",
				durationSeconds: 201,
			}),
		);
		expect(scored.rejected).toBe(false);
	});

	it("rejects an instrumental upload only when the song isn't itself instrumental", () => {
		const normalSong = scoreCandidate(
			SONG,
			candidate({
				title: "Blinding Lights (Instrumental)",
				durationSeconds: 201,
			}),
		);
		expect(normalSong.rejected).toBe(true);

		const instrumentalSong = scoreCandidate(
			{ ...SONG, name: "Blinding Lights - Instrumental" },
			candidate({
				title: "Blinding Lights (Instrumental)",
				channel: "The Weeknd - Topic",
				durationSeconds: 201,
			}),
		);
		expect(instrumentalSong.rejected).toBe(false);
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

	it("softly penalizes unexplained title tokens", () => {
		const song = { ...SONG, name: "Song", artists: ["Artist"] };
		const exact = scoreCandidate(song, candidate({ title: "Artist - Song" }));
		const noisy = scoreCandidate(
			song,
			candidate({ title: "Artist reacts to Song FULL BREAKDOWN" }),
		);

		expect(exact.score).toBe(0.75);
		expect(noisy.rejected).toBe(false);
		expect(noisy.score).toBeLessThan(exact.score);
		expect(noisy.score).toBeGreaterThan(0.7);
	});

	it("does not penalize standard upload-format words", () => {
		const song = { ...SONG, name: "Song", artists: ["Artist"] };
		const scored = scoreCandidate(
			song,
			candidate({ title: "Artist - Song Official Audio 4K Lyrics" }),
		);
		expect(scored.score).toBe(0.85);
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

describe("toCandidateSnapshots", () => {
	function scored(
		p: Partial<ScoredCandidate> & { videoId: string },
	): ScoredCandidate {
		return {
			candidate: candidate({ videoId: p.videoId, title: p.videoId }),
			score: p.score ?? 0,
			reasons: p.reasons ?? [],
			rejected: p.rejected ?? false,
			rejectReason: p.rejectReason,
		};
	}

	it("orders viable-by-score first, then rejected, and ranks only viable", () => {
		const snaps = toCandidateSnapshots([
			scored({ videoId: "mid", score: 0.5 }),
			scored({
				videoId: "rej",
				score: 0.9,
				rejected: true,
				rejectReason: 'contains "live"',
			}),
			scored({ videoId: "top", score: 0.7 }),
		]);

		// Viable come first ordered by score desc (top, mid), then rejected (rej),
		// regardless of the rejected one's raw score.
		expect(snaps.map((s) => s.videoId)).toEqual(["top", "mid", "rej"]);
		expect(snaps.map((s) => s.rank)).toEqual([1, 2, null]);
		expect(snaps[2]?.rejectReason).toBe('contains "live"');
	});

	it("stamps every snapshot (viable and rejected) with the current scoring version", () => {
		const snaps = toCandidateSnapshots([
			scored({ videoId: "ok", score: 0.8 }),
			scored({ videoId: "bad", rejected: true, rejectReason: "x" }),
		]);
		expect(snaps.map((s) => s.scoringVersion)).toEqual([
			SCORING_VERSION,
			SCORING_VERSION,
		]);
	});

	it("carries the full candidate provenance and null-defaults an absent reject reason", () => {
		const [snap] = toCandidateSnapshots([
			{
				candidate: candidate({
					videoId: "v",
					url: "https://youtu.be/v",
					title: "Los Enanitos Verdes - Tequila (En Vivo)",
					channel: "Fan Uploads",
					durationSeconds: 246,
					thumbnailUrl: "https://img/v.jpg",
				}),
				score: 0.63,
				reasons: ["title partially matches song title"],
				rejected: false,
			},
		]);

		expect(snap).toMatchObject({
			videoId: "v",
			url: "https://youtu.be/v",
			title: "Los Enanitos Verdes - Tequila (En Vivo)",
			channel: "Fan Uploads",
			durationSeconds: 246,
			thumbnailUrl: "https://img/v.jpg",
			score: 0.63,
			reasons: ["title partially matches song title"],
			rejected: false,
			rejectReason: null,
			rank: 1,
		});
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
