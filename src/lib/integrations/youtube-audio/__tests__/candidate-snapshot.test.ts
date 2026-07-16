import { describe, expect, it } from "vitest";
import {
	type MatchCandidateSnapshot,
	MatchCandidateSnapshotSchema,
} from "../types";

const validCandidate: MatchCandidateSnapshot = {
	videoId: "dQw4w9WgXcQ",
	url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
	title: "Rick Astley - Never Gonna Give You Up (Official Music Video)",
	channel: "Rick Astley",
	durationSeconds: 212,
	thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
	score: 0.87,
	reasons: [
		"title contains full song title",
		"artist present in title/channel",
		"duration within 5s",
	],
	rejected: false,
	rejectReason: null,
	rank: 1,
};

const rejectedCandidate: MatchCandidateSnapshot = {
	videoId: "abc123",
	url: "https://www.youtube.com/watch?v=abc123",
	title: "Never Gonna Give You Up (Live)",
	channel: null,
	durationSeconds: null,
	thumbnailUrl: null,
	score: 0,
	reasons: [],
	rejected: true,
	rejectReason: 'contains "live"',
	rank: null,
};

describe("MatchCandidateSnapshotSchema", () => {
	describe("round-trip through JSONB serialization", () => {
		it("preserves a viable candidate through JSON stringify/parse", () => {
			const snapshots: MatchCandidateSnapshot[] = [validCandidate];
			const serialized = JSON.stringify(snapshots);
			const parsed = JSON.parse(serialized) as unknown[];
			const result = parsed.map((item) =>
				MatchCandidateSnapshotSchema.parse(item),
			);
			expect(result).toEqual(snapshots);
		});

		it("preserves a rejected candidate (null fields) through JSON stringify/parse", () => {
			const snapshots: MatchCandidateSnapshot[] = [rejectedCandidate];
			const serialized = JSON.stringify(snapshots);
			const parsed = JSON.parse(serialized) as unknown[];
			const result = parsed.map((item) =>
				MatchCandidateSnapshotSchema.parse(item),
			);
			expect(result).toEqual(snapshots);
		});

		it("preserves a mixed viable+rejected set through JSON stringify/parse", () => {
			const snapshots: MatchCandidateSnapshot[] = [
				validCandidate,
				rejectedCandidate,
			];
			const serialized = JSON.stringify(snapshots);
			const parsed = JSON.parse(serialized) as unknown[];
			const result = parsed.map((item) =>
				MatchCandidateSnapshotSchema.parse(item),
			);
			expect(result).toEqual(snapshots);
		});
	});

	describe("drift detection", () => {
		it("fails when a required field is missing (videoId renamed → catches rename drift)", () => {
			const { videoId: _dropped, ...withoutVideoId } = validCandidate;
			const result = MatchCandidateSnapshotSchema.safeParse(withoutVideoId);
			expect(result.success).toBe(false);
		});

		it("fails when url is missing", () => {
			const { url: _dropped, ...withoutUrl } = validCandidate;
			const result = MatchCandidateSnapshotSchema.safeParse(withoutUrl);
			expect(result.success).toBe(false);
		});

		it("fails when score is missing", () => {
			const { score: _dropped, ...withoutScore } = validCandidate;
			const result = MatchCandidateSnapshotSchema.safeParse(withoutScore);
			expect(result.success).toBe(false);
		});

		it("fails when rejected is the wrong type", () => {
			const result = MatchCandidateSnapshotSchema.safeParse({
				...validCandidate,
				rejected: "false",
			});
			expect(result.success).toBe(false);
		});

		it("fails when reasons is not an array", () => {
			const result = MatchCandidateSnapshotSchema.safeParse({
				...validCandidate,
				reasons: "title contains full song title",
			});
			expect(result.success).toBe(false);
		});

		it("accepts legacy rows without scoringVersion (written before versioning existed)", () => {
			// Both fixtures above deliberately omit scoringVersion: the field is
			// optional so pre-versioning JSONB rows keep parsing.
			expect("scoringVersion" in validCandidate).toBe(false);
			const result = MatchCandidateSnapshotSchema.safeParse(validCandidate);
			expect(result.success).toBe(true);
		});

		it("round-trips a stamped row and preserves scoringVersion", () => {
			const stamped = { ...validCandidate, scoringVersion: 1 };
			const parsed = MatchCandidateSnapshotSchema.parse(
				JSON.parse(JSON.stringify(stamped)),
			);
			expect(parsed.scoringVersion).toBe(1);
		});

		it("accepts null for nullable fields (channel, durationSeconds, thumbnailUrl, rejectReason, rank)", () => {
			const allNullable: MatchCandidateSnapshot = {
				...validCandidate,
				channel: null,
				durationSeconds: null,
				thumbnailUrl: null,
				rejectReason: null,
				rank: null,
			};
			const result = MatchCandidateSnapshotSchema.safeParse(allNullable);
			expect(result.success).toBe(true);
		});
	});
});
