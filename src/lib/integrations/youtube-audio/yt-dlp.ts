/**
 * yt-dlp wrapper: availability check, YouTube search, candidate hydration, and
 * audio download. The JSON parsing is split into pure functions
 * (parseSearchOutput / parseVideoJson) so the defensive shape-handling is
 * unit-testable without spawning a process.
 *
 * All yt-dlp output is untrusted: parse defensively and never shell-interpolate.
 */

import { mkdir, readdir } from "node:fs/promises";
import { Result } from "better-result";
import { YtDlpError } from "@/lib/shared/errors/external/youtube-audio";
import { audioFeatureBackfillConfig } from "./config";
import { runCommand } from "./spawn";
import type { YoutubeCandidate } from "./types";

const YT_DLP = "yt-dlp";

function videoUrl(videoId: string): string {
	return `https://www.youtube.com/watch?v=${videoId}`;
}

function tryJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

function asNumber(v: unknown): number | null {
	return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function asString(v: unknown): string | null {
	return typeof v === "string" && v.length > 0 ? v : null;
}

function pickThumbnail(entry: Record<string, unknown>): string | null {
	const direct = asString(entry.thumbnail);
	if (direct) return direct;
	const thumbs = entry.thumbnails;
	if (Array.isArray(thumbs) && thumbs.length > 0) {
		const last = thumbs[thumbs.length - 1];
		if (last && typeof last === "object") {
			return asString((last as Record<string, unknown>).url);
		}
	}
	return null;
}

/** Map one yt-dlp entry/video object to a candidate, or null if no usable id. */
function toCandidate(entry: Record<string, unknown>): YoutubeCandidate | null {
	const videoId = asString(entry.id);
	if (!videoId) return null;
	return {
		videoId,
		url: asString(entry.webpage_url) ?? videoUrl(videoId),
		title: asString(entry.title) ?? "",
		channel: asString(entry.channel) ?? asString(entry.uploader),
		durationSeconds: asNumber(entry.duration),
		thumbnailUrl: pickThumbnail(entry),
	};
}

function collectEntries(obj: unknown, out: Record<string, unknown>[]): void {
	if (Array.isArray(obj)) {
		for (const e of obj) collectEntries(e, out);
		return;
	}
	if (obj && typeof obj === "object") {
		const rec = obj as Record<string, unknown>;
		if (Array.isArray(rec.entries)) {
			for (const e of rec.entries) {
				if (e && typeof e === "object") out.push(e as Record<string, unknown>);
			}
			return;
		}
		if (rec.id || rec.url) out.push(rec);
	}
}

/**
 * Parse `--dump-single-json --flat-playlist ytsearchN:` output. Accepts both a
 * single object with an `entries` array and newline-delimited JSON objects,
 * because yt-dlp versions differ.
 */
export function parseSearchOutput(stdout: string): YoutubeCandidate[] {
	const text = stdout.trim();
	if (!text) return [];

	const entries: Record<string, unknown>[] = [];
	const whole = tryJson(text);
	if (whole !== null) {
		collectEntries(whole, entries);
	} else {
		for (const line of text.split("\n")) {
			const t = line.trim();
			if (!t) continue;
			const obj = tryJson(t);
			if (obj !== null) collectEntries(obj, entries);
		}
	}

	const candidates: YoutubeCandidate[] = [];
	for (const e of entries) {
		const c = toCandidate(e);
		if (c) candidates.push(c);
	}
	return candidates;
}

/** Parse `--dump-single-json --no-playlist <watch url>` (one video object). */
export function parseVideoJson(stdout: string): YoutubeCandidate | null {
	const obj = tryJson(stdout.trim());
	if (!obj || typeof obj !== "object") return null;
	return toCandidate(obj as Record<string, unknown>);
}

export async function checkYtDlpAvailable(): Promise<
	Result<string, YtDlpError>
> {
	const res = await runCommand([YT_DLP, "--version"], { timeoutMs: 10_000 });
	if (res.timedOut || res.exitCode !== 0) {
		return Result.err(
			new YtDlpError({
				message: `yt-dlp not available (exit ${res.exitCode})`,
				code: "unavailable",
				exitCode: res.exitCode,
				stderr: res.stderr,
			}),
		);
	}
	return Result.ok(res.stdout.trim());
}

export async function searchYouTube(
	query: string,
	limit: number = audioFeatureBackfillConfig.searchResults,
): Promise<Result<YoutubeCandidate[], YtDlpError>> {
	const res = await runCommand(
		[
			YT_DLP,
			"--dump-single-json",
			"--skip-download",
			"--flat-playlist",
			`ytsearch${limit}:${query}`,
		],
		{ timeoutMs: audioFeatureBackfillConfig.requestTimeoutMs },
	);

	if (res.timedOut) {
		return Result.err(
			new YtDlpError({ message: "yt-dlp search timed out", code: "timeout" }),
		);
	}
	if (res.exitCode !== 0) {
		return Result.err(
			new YtDlpError({
				message: "yt-dlp search failed",
				code: "nonzero_exit",
				exitCode: res.exitCode,
				stderr: res.stderr,
			}),
		);
	}

	return Result.ok(parseSearchOutput(res.stdout));
}

export async function hydrateCandidate(
	videoId: string,
): Promise<Result<YoutubeCandidate, YtDlpError>> {
	const res = await runCommand(
		[
			YT_DLP,
			"--dump-single-json",
			"--skip-download",
			"--no-playlist",
			videoUrl(videoId),
		],
		{ timeoutMs: audioFeatureBackfillConfig.requestTimeoutMs },
	);

	if (res.timedOut) {
		return Result.err(
			new YtDlpError({ message: "yt-dlp hydrate timed out", code: "timeout" }),
		);
	}
	if (res.exitCode !== 0) {
		return Result.err(
			new YtDlpError({
				message: "yt-dlp hydrate failed",
				code: "nonzero_exit",
				exitCode: res.exitCode,
				stderr: res.stderr,
			}),
		);
	}

	const candidate = parseVideoJson(res.stdout);
	if (!candidate) {
		return Result.err(
			new YtDlpError({
				message: "yt-dlp hydrate returned unparseable JSON",
				code: "parse_failed",
			}),
		);
	}
	return Result.ok(candidate);
}

/**
 * Download the best audio for `url` into `jobDir/source.<ext>` and return the
 * resolved path. YouTube sources are usually webm/m4a/opus — we keep whatever
 * container yt-dlp picks; clips are transcoded to mp3 later by ffmpeg.
 */
export async function downloadAudio(
	url: string,
	jobDir: string,
): Promise<Result<string, YtDlpError>> {
	await mkdir(jobDir, { recursive: true });

	const res = await runCommand(
		[
			YT_DLP,
			"--no-playlist",
			"--no-continue",
			"--restrict-filenames",
			"--max-filesize",
			`${audioFeatureBackfillConfig.maxDownloadMb}M`,
			"-f",
			"bestaudio[abr<=192]/bestaudio/best",
			"-o",
			`${jobDir}/source.%(ext)s`,
			url,
		],
		{ timeoutMs: audioFeatureBackfillConfig.requestTimeoutMs },
	);

	if (res.timedOut) {
		return Result.err(
			new YtDlpError({ message: "yt-dlp download timed out", code: "timeout" }),
		);
	}
	if (res.exitCode !== 0) {
		return Result.err(
			new YtDlpError({
				message: "yt-dlp download failed",
				code: "download_failed",
				exitCode: res.exitCode,
				stderr: res.stderr,
			}),
		);
	}

	const files = await readdir(jobDir);
	const match = files.find((f) => f.startsWith("source."));
	if (!match) {
		return Result.err(
			new YtDlpError({
				message: "yt-dlp reported success but no source file was written",
				code: "download_failed",
			}),
		);
	}
	return Result.ok(`${jobDir}/${match}`);
}
