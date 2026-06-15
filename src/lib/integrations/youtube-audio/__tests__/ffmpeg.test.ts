import { describe, expect, it } from "vitest";
import { buildClipArgs, buildProbeArgs, computeClipStarts } from "../ffmpeg";

const CONFIG = { clipSeconds: 30, clipCount: 3, clipBitrateKbps: 128 };

describe("computeClipStarts", () => {
	it("returns a single clip for sources <= clipSeconds", () => {
		const specs = computeClipStarts(20, CONFIG);
		expect(specs).toEqual([{ startSeconds: 0, durationSeconds: 20 }]);
	});

	it("returns a single full-length clip exactly at the boundary", () => {
		const specs = computeClipStarts(30, CONFIG);
		expect(specs).toEqual([{ startSeconds: 0, durationSeconds: 30 }]);
	});

	it("samples ~25/50/75% centers for a long source", () => {
		// 200s, 30s clips: centers at 50/100/150 → starts 35/85/135.
		const specs = computeClipStarts(200, CONFIG);
		expect(specs.map((s) => s.startSeconds)).toEqual([35, 85, 135]);
		expect(specs.every((s) => s.durationSeconds === 30)).toBe(true);
	});

	it("clamps the last clip start to a valid position", () => {
		const specs = computeClipStarts(40, CONFIG);
		// duration-clip = 10 is the max start; 75% center would overflow.
		expect(specs.every((s) => s.startSeconds <= 10)).toBe(true);
	});

	it("de-duplicates collapsed starts", () => {
		const specs = computeClipStarts(31, CONFIG);
		const starts = specs.map((s) => s.startSeconds);
		expect(new Set(starts).size).toBe(starts.length);
	});
});

describe("buildClipArgs", () => {
	it("scopes the destination path by job dir and emits mp3 encode flags", () => {
		const args = buildClipArgs({
			sourcePath: "/tmp/hearted-audio-feature-backfill/job-1/source.webm",
			startSeconds: 35,
			durationSeconds: 30,
			destPath: "/tmp/hearted-audio-feature-backfill/job-1/clip_0.mp3",
			bitrateKbps: 128,
		});
		expect(args[0]).toBe("ffmpeg");
		expect(args).toContain("libmp3lame");
		expect(args).toContain("-ss");
		expect(args[args.indexOf("-ss") + 1]).toBe("35");
		expect(args).toContain("-b:a");
		expect(args[args.indexOf("-b:a") + 1]).toBe("128k");
		expect(args[args.length - 1]).toContain("/job-1/clip_0.mp3");
	});
});

describe("buildProbeArgs", () => {
	it("requests json format + streams from ffprobe", () => {
		const args = buildProbeArgs("/tmp/x/source.m4a");
		expect(args[0]).toBe("ffprobe");
		expect(args).toContain("-show_streams");
		expect(args).toContain("-show_format");
		expect(args[args.length - 1]).toBe("/tmp/x/source.m4a");
	});
});
