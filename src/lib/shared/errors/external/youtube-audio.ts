/**
 * Errors for the yt-dlp / ffmpeg external-process toolchain used by the audio
 * feature backfill. Tagged so the orchestrator can map each one to a stored
 * AudioBackfillErrorCode and decide retry vs. terminal.
 */

import { TaggedError } from "better-result";

export type YtDlpErrorCode =
	| "unavailable"
	| "spawn_failed"
	| "timeout"
	| "nonzero_exit"
	| "parse_failed"
	| "no_candidates"
	| "hydrate_failed"
	| "download_failed";

export class YtDlpError extends TaggedError("YtDlpError")<{
	message: string;
	code: YtDlpErrorCode;
	exitCode?: number;
	stderr?: string;
}>() {}

export type FfmpegErrorCode =
	| "unavailable"
	| "spawn_failed"
	| "timeout"
	| "nonzero_exit"
	| "probe_failed"
	| "no_audio_stream"
	| "duration_invalid"
	| "too_large"
	| "clip_failed";

export class FfmpegError extends TaggedError("FfmpegError")<{
	message: string;
	code: FfmpegErrorCode;
	exitCode?: number;
	stderr?: string;
}>() {}
