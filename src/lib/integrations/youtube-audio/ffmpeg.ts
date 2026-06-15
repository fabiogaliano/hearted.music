/**
 * ffprobe validation + ffmpeg clip extraction. The argument and clip-start math
 * are pure exported functions (computeClipStarts / buildClipArgs / buildProbeArgs)
 * so they're unit-testable; the IO functions wrap them with spawn + fs.
 */

import { stat, unlink } from "node:fs/promises";
import { Result } from "better-result";
import { FfmpegError } from "@/lib/shared/errors/external/youtube-audio";
import { runCommand } from "./spawn";
import type { ClipFile, ProbeResult } from "./types";

const FFMPEG = "ffmpeg";
const FFPROBE = "ffprobe";

// Full DJ mixes / uploads of whole albums aren't a single song; reject them so a
// clip never represents the wrong track. No hard minimum — intros count.
export const MAX_SOURCE_DURATION_SECONDS = 20 * 60;
// ReccoBeats rejects uploads over 5MB. 30s @ 128kbps mp3 is ~0.5MB, so this is a
// wide safety margin that still guards against a bad encode.
export const MAX_CLIP_BYTES = 5 * 1024 * 1024;

interface ClipSpec {
	startSeconds: number;
	durationSeconds: number;
}

/**
 * Clip start positions. <=30s sources yield a single clip of whatever exists;
 * longer sources sample evenly spaced centers (3 clips → ~25/50/75%), clamped to
 * valid starts and de-duplicated when a short duration collapses them.
 */
export function computeClipStarts(
	durationSeconds: number,
	config: { clipSeconds: number; clipCount: number },
): ClipSpec[] {
	const clipDuration = Math.min(durationSeconds, config.clipSeconds);
	if (durationSeconds <= config.clipSeconds) {
		return [{ startSeconds: 0, durationSeconds: clipDuration }];
	}

	const n = Math.max(1, config.clipCount);
	const seen = new Set<number>();
	const out: ClipSpec[] = [];
	for (let i = 0; i < n; i++) {
		const fraction = (i + 1) / (n + 1);
		const raw = durationSeconds * fraction - clipDuration / 2;
		const clamped = Math.max(0, Math.min(raw, durationSeconds - clipDuration));
		const rounded = Math.round(clamped * 1000) / 1000;
		if (!seen.has(rounded)) {
			seen.add(rounded);
			out.push({ startSeconds: rounded, durationSeconds: clipDuration });
		}
	}
	return out;
}

export function buildProbeArgs(sourcePath: string): string[] {
	return [
		FFPROBE,
		"-v",
		"error",
		"-print_format",
		"json",
		"-show_format",
		"-show_streams",
		sourcePath,
	];
}

export function buildClipArgs(opts: {
	sourcePath: string;
	startSeconds: number;
	durationSeconds: number;
	destPath: string;
	bitrateKbps: number;
}): string[] {
	return [
		FFMPEG,
		"-v",
		"error",
		"-y",
		"-ss",
		String(opts.startSeconds),
		"-t",
		String(opts.durationSeconds),
		"-i",
		opts.sourcePath,
		"-vn",
		"-ac",
		"2",
		"-ar",
		"44100",
		"-codec:a",
		"libmp3lame",
		"-b:a",
		`${opts.bitrateKbps}k`,
		opts.destPath,
	];
}

interface FfprobeJson {
	streams?: { codec_type?: string; duration?: string }[];
	format?: { duration?: string; size?: string };
}

export async function probeAudio(
	sourcePath: string,
): Promise<Result<ProbeResult, FfmpegError>> {
	const res = await runCommand(buildProbeArgs(sourcePath), {
		timeoutMs: 30_000,
	});
	if (res.timedOut || res.exitCode !== 0) {
		return Result.err(
			new FfmpegError({
				message: `ffprobe failed (exit ${res.exitCode})`,
				code: "probe_failed",
				exitCode: res.exitCode,
				stderr: res.stderr,
			}),
		);
	}

	let parsed: FfprobeJson;
	try {
		parsed = JSON.parse(res.stdout) as FfprobeJson;
	} catch {
		return Result.err(
			new FfmpegError({
				message: "ffprobe returned unparseable JSON",
				code: "probe_failed",
			}),
		);
	}

	const streams = parsed.streams ?? [];
	const audioStream = streams.find((s) => s.codec_type === "audio");
	if (!audioStream) {
		return Result.err(
			new FfmpegError({
				message: "source has no audio stream",
				code: "no_audio_stream",
			}),
		);
	}

	const durationSeconds = Number.parseFloat(
		parsed.format?.duration ?? audioStream.duration ?? "",
	);
	if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
		return Result.err(
			new FfmpegError({
				message: "could not determine source duration",
				code: "duration_invalid",
			}),
		);
	}

	let sizeBytes = Number.parseInt(parsed.format?.size ?? "", 10);
	if (!Number.isFinite(sizeBytes)) {
		sizeBytes = (await stat(sourcePath)).size;
	}

	return Result.ok({ durationSeconds, hasAudioStream: true, sizeBytes });
}

/** Probe + enforce the duration ceiling and download-size cap. */
export async function probeAndValidate(
	sourcePath: string,
	maxDownloadBytes: number,
): Promise<Result<ProbeResult, FfmpegError>> {
	const probeResult = await probeAudio(sourcePath);
	if (Result.isError(probeResult)) return probeResult;
	const probe = probeResult.value;

	if (probe.durationSeconds > MAX_SOURCE_DURATION_SECONDS) {
		return Result.err(
			new FfmpegError({
				message: `source too long (${Math.round(probe.durationSeconds)}s > ${MAX_SOURCE_DURATION_SECONDS}s)`,
				code: "duration_invalid",
			}),
		);
	}
	if (probe.sizeBytes > maxDownloadBytes) {
		return Result.err(
			new FfmpegError({
				message: `source too large (${probe.sizeBytes} bytes)`,
				code: "too_large",
			}),
		);
	}
	return Result.ok(probe);
}

/**
 * Extract mp3 clips from the source. Each clip must encode and stay under the
 * 5MB upload cap; any failure fails the whole extraction so we never analyze a
 * partial set.
 */
export async function extractClips(
	sourcePath: string,
	durationSeconds: number,
	jobDir: string,
	config: { clipSeconds: number; clipCount: number; clipBitrateKbps: number },
): Promise<Result<ClipFile[], FfmpegError>> {
	const specs = computeClipStarts(durationSeconds, config);
	const clips: ClipFile[] = [];

	for (const [i, spec] of specs.entries()) {
		const destPath = `${jobDir}/clip_${i}.mp3`;
		const res = await runCommand(
			buildClipArgs({
				sourcePath,
				startSeconds: spec.startSeconds,
				durationSeconds: spec.durationSeconds,
				destPath,
				bitrateKbps: config.clipBitrateKbps,
			}),
			{ timeoutMs: 60_000 },
		);

		if (res.timedOut || res.exitCode !== 0) {
			return Result.err(
				new FfmpegError({
					message: `ffmpeg clip ${i} failed (exit ${res.exitCode})`,
					code: "clip_failed",
					exitCode: res.exitCode,
					stderr: res.stderr,
				}),
			);
		}

		const size = (await stat(destPath).catch(() => null))?.size ?? 0;
		if (size === 0) {
			return Result.err(
				new FfmpegError({
					message: `ffmpeg clip ${i} produced no output`,
					code: "clip_failed",
				}),
			);
		}
		if (size > MAX_CLIP_BYTES) {
			await unlink(destPath).catch(() => {});
			return Result.err(
				new FfmpegError({
					message: `clip ${i} exceeds upload size cap (${size} bytes)`,
					code: "too_large",
				}),
			);
		}

		clips.push({
			path: destPath,
			startSeconds: spec.startSeconds,
			durationSeconds: spec.durationSeconds,
		});
	}

	return Result.ok(clips);
}
