/**
 * YouTube-audio acquisition: turn a song + source (search or explicit URL) into
 * a downloaded, validated source file and its extracted clips, plus the chosen
 * candidate's provenance. No DB access — the domain orchestrator owns DB writes
 * and settlement. Low-confidence search returns `manual_needed` (a value, not an
 * error); IO failures come back as typed Result errors.
 */

import { Result } from "better-result";
import type {
	FfmpegError,
	YtDlpError,
} from "@/lib/shared/errors/external/youtube-audio";
import { YtDlpError as YtDlpErrorClass } from "@/lib/shared/errors/external/youtube-audio";
import { audioFeatureBackfillConfig } from "./config";
import { extractClips, probeAndValidate } from "./ffmpeg";
import { scoreCandidates } from "./scoring";
import type {
	ClipFile,
	ScoredCandidate,
	SongForScoring,
	YoutubeCandidate,
} from "./types";
import { extractYoutubeVideoId } from "./url";
import {
	downloadAudio,
	hydrateCandidate,
	searchYouTube,
	summarizeYtDlpFailure,
} from "./yt-dlp";

export type ManualNeededCode =
	| "yt_search_no_candidates"
	| "yt_search_low_confidence";

export interface AcquiredSource {
	kind: "acquired";
	candidate: YoutubeCandidate;
	sourcePath: string;
	durationSeconds: number;
	clips: ClipFile[];
	searchQuery: string | null;
	matchScore: number | null;
	matchReasons: string[];
	candidateRank: number | null;
	scored: ScoredCandidate[];
}

export interface ManualNeeded {
	kind: "manual_needed";
	code: ManualNeededCode;
	reason: string;
	scored: ScoredCandidate[];
}

export type AcquireResult = AcquiredSource | ManualNeeded;

export function buildSearchQuery(song: SongForScoring): string {
	const primaryArtist = song.artists[0] ?? "";
	return `${primaryArtist} ${song.name}`.trim();
}

interface AcquireInput {
	sourceType: "youtube_search" | "youtube_url";
	sourceUrl: string | null;
	song: SongForScoring;
	jobDir: string;
}

/** Resolve the source candidate (search+score, or hydrate the operator URL). */
async function resolveCandidate(
	input: AcquireInput,
): Promise<
	Result<
		| { candidate: YoutubeCandidate; provenance: SearchProvenance }
		| ManualNeeded,
		YtDlpError
	>
> {
	if (input.sourceType === "youtube_url") {
		if (!input.sourceUrl) {
			return Result.err(
				new YtDlpErrorClass({
					message: "manual job missing source_url",
					code: "download_failed",
				}),
			);
		}
		const parsed = extractYoutubeVideoId(input.sourceUrl);
		if (!parsed) {
			return Result.err(
				new YtDlpErrorClass({
					message: "source_url is not a valid YouTube URL",
					code: "download_failed",
				}),
			);
		}
		const hydrated = await hydrateCandidate(parsed.videoId);
		if (Result.isError(hydrated)) return Result.err(hydrated.error);
		return Result.ok({
			candidate: hydrated.value,
			provenance: {
				searchQuery: null,
				matchScore: null,
				matchReasons: [],
				candidateRank: null,
				scored: [],
			},
		});
	}

	const query = buildSearchQuery(input.song);
	const searchResult = await searchYouTube(query);
	if (Result.isError(searchResult)) return Result.err(searchResult.error);

	const flat = searchResult.value;
	if (flat.length === 0) {
		return Result.ok({
			kind: "manual_needed",
			code: "yt_search_no_candidates",
			reason: `no YouTube candidates for "${query}"`,
			scored: [],
		});
	}

	// Flat-playlist search omits reliable duration/channel, and scoring leans on
	// both, so hydrate each candidate's full metadata before scoring. Sequential
	// (one yt-dlp call each) and capped to the configured search size. Failed
	// hydrations are dropped as long as at least one candidate survives.
	const hydrated: YoutubeCandidate[] = [];
	const hydrateFailures: YtDlpError[] = [];
	for (const candidate of flat.slice(
		0,
		audioFeatureBackfillConfig.searchResults,
	)) {
		const result = await hydrateCandidate(candidate.videoId);
		if (Result.isOk(result)) hydrated.push(result.value);
		else hydrateFailures.push(result.error);
	}
	if (hydrated.length === 0) {
		// Every candidate failed to hydrate: don't auto-insert off weak flat data.
		// A typed error defers/retries the job instead of marking it manual. Carry
		// a sample of yt-dlp's stderr (e.g. "Sign in to confirm you're not a bot")
		// into the message so the real cause reaches the stored error_message
		// instead of being swallowed with the per-candidate Results here.
		const sample = hydrateFailures[0];
		const detail =
			summarizeYtDlpFailure(sample?.stderr) ?? sample?.message ?? null;
		return Result.err(
			new YtDlpErrorClass({
				message: detail
					? `all ${flat.length} search candidates failed to hydrate: ${detail}`
					: `all ${flat.length} search candidates failed to hydrate`,
				code: "hydrate_failed",
				stderr: sample?.stderr,
			}),
		);
	}

	const decision = scoreCandidates(input.song, hydrated, {
		minScore: audioFeatureBackfillConfig.minScore,
		minScoreGap: audioFeatureBackfillConfig.minScoreGap,
	});
	if (decision.kind === "manual_needed") {
		return Result.ok({
			kind: "manual_needed",
			code: "yt_search_low_confidence",
			reason: decision.reason,
			scored: decision.scored,
		});
	}

	const rank =
		decision.scored
			.filter((s) => !s.rejected)
			.sort((a, b) => b.score - a.score)
			.findIndex((s) => s.candidate.videoId === decision.candidate.videoId) + 1;

	return Result.ok({
		candidate: decision.candidate,
		provenance: {
			searchQuery: query,
			matchScore: decision.score,
			matchReasons: decision.reasons,
			candidateRank: rank > 0 ? rank : null,
			scored: decision.scored,
		},
	});
}

interface SearchProvenance {
	searchQuery: string | null;
	matchScore: number | null;
	matchReasons: string[];
	candidateRank: number | null;
	scored: ScoredCandidate[];
}

export async function acquireSource(
	input: AcquireInput,
): Promise<Result<AcquireResult, YtDlpError | FfmpegError>> {
	const resolved = await resolveCandidate(input);
	if (Result.isError(resolved)) return Result.err(resolved.error);
	if ("kind" in resolved.value && resolved.value.kind === "manual_needed") {
		return Result.ok(resolved.value);
	}

	const { candidate, provenance } = resolved.value as {
		candidate: YoutubeCandidate;
		provenance: SearchProvenance;
	};

	const downloadResult = await downloadAudio(candidate.url, input.jobDir);
	if (Result.isError(downloadResult)) return Result.err(downloadResult.error);

	const probeResult = await probeAndValidate(
		downloadResult.value,
		audioFeatureBackfillConfig.maxDownloadMb * 1024 * 1024,
	);
	if (Result.isError(probeResult)) return Result.err(probeResult.error);

	const clipsResult = await extractClips(
		downloadResult.value,
		probeResult.value.durationSeconds,
		input.jobDir,
		audioFeatureBackfillConfig,
	);
	if (Result.isError(clipsResult)) return Result.err(clipsResult.error);

	return Result.ok({
		kind: "acquired",
		candidate,
		sourcePath: downloadResult.value,
		durationSeconds: probeResult.value.durationSeconds,
		clips: clipsResult.value,
		searchQuery: provenance.searchQuery,
		matchScore: provenance.matchScore,
		matchReasons: provenance.matchReasons,
		candidateRank: provenance.candidateRank,
		scored: provenance.scored,
	});
}
