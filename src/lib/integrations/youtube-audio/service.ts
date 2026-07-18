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

function buildRetrySearchQuery(
	song: SongForScoring,
	initialQuery: string,
): string | null {
	const primaryArtist = song.artists[0] ?? "";
	const album = song.albumName?.trim();
	const retry = album
		? `${primaryArtist} ${song.name} ${album}`.trim()
		: `${initialQuery} ${audioFeatureBackfillConfig.searchRetry.fallbackSuffixWithoutAlbum}`.trim();
	return retry === initialQuery ? null : retry;
}

interface AcquireInput {
	sourceType: "youtube_search" | "youtube_url";
	sourceUrl: string | null;
	song: SongForScoring;
	jobDir: string;
	/** Optional egress proxy for all yt-dlp calls (see buildProxyArgs). */
	proxy?: string;
	signal?: AbortSignal;
}

interface HydratedSearchCandidates {
	candidates: YoutubeCandidate[];
	videoIds: Set<string>;
}

async function searchAndHydrate(
	input: AcquireInput,
	query: string,
	excludedVideoIds: ReadonlySet<string> = new Set(),
): Promise<Result<HydratedSearchCandidates, YtDlpError>> {
	const searchResult = await searchYouTube(
		query,
		undefined,
		input.proxy,
		input.signal,
	);
	if (Result.isError(searchResult)) return Result.err(searchResult.error);

	const flat = searchResult.value;
	const videoIds = new Set(flat.map((candidate) => candidate.videoId));
	const hydrated: YoutubeCandidate[] = [];
	const hydrateFailures: YtDlpError[] = [];
	const candidatesToHydrate = flat
		.filter((candidate) => !excludedVideoIds.has(candidate.videoId))
		.slice(0, audioFeatureBackfillConfig.searchResults);

	// Flat-playlist search omits reliable duration/channel, and scoring leans on
	// both, so hydrate each candidate's full metadata before scoring. Failed
	// hydrations are dropped as long as at least one candidate survives.
	for (const candidate of candidatesToHydrate) {
		input.signal?.throwIfAborted();
		const result = await hydrateCandidate(
			candidate.videoId,
			input.proxy,
			input.signal,
		);
		if (Result.isOk(result)) hydrated.push(result.value);
		else hydrateFailures.push(result.error);
	}
	if (candidatesToHydrate.length > 0 && hydrated.length === 0) {
		// Every candidate failed to hydrate: don't auto-insert off weak flat data.
		// A typed error defers/retries the job instead of marking it manual. Carry
		// a sample of yt-dlp's stderr into the stored error_message.
		const sample = hydrateFailures[0];
		const detail =
			summarizeYtDlpFailure(sample?.stderr) ?? sample?.message ?? null;
		return Result.err(
			new YtDlpErrorClass({
				message: detail
					? `all ${candidatesToHydrate.length} search candidates failed to hydrate: ${detail}`
					: `all ${candidatesToHydrate.length} search candidates failed to hydrate`,
				code: "hydrate_failed",
				stderr: sample?.stderr,
			}),
		);
	}

	return Result.ok({ candidates: hydrated, videoIds });
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
		const hydrated = await hydrateCandidate(
			parsed.videoId,
			input.proxy,
			input.signal,
		);
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
	const initial = await searchAndHydrate(input, query);
	if (Result.isError(initial)) return Result.err(initial.error);

	let candidates = initial.value.candidates;
	let decision = scoreCandidates(input.song, candidates, {
		minScore: audioFeatureBackfillConfig.minScore,
	});
	let selectedQuery = query;

	if (candidates.length === 0 || decision.kind === "manual_needed") {
		const retryQuery = buildRetrySearchQuery(input.song, query);
		if (retryQuery) {
			const retry = await searchAndHydrate(
				input,
				retryQuery,
				initial.value.videoIds,
			);
			if (Result.isError(retry)) return Result.err(retry.error);
			candidates = [...candidates, ...retry.value.candidates];
			decision = scoreCandidates(input.song, candidates, {
				minScore: audioFeatureBackfillConfig.minScore,
			});
			if (
				decision.kind === "selected" &&
				!initial.value.videoIds.has(decision.candidate.videoId)
			) {
				selectedQuery = retryQuery;
			}
		}
	}

	if (decision.kind === "manual_needed") {
		return Result.ok({
			kind: "manual_needed",
			code:
				candidates.length === 0
					? "yt_search_no_candidates"
					: "yt_search_low_confidence",
			reason:
				candidates.length === 0
					? `no YouTube candidates for "${query}" after retry`
					: decision.reason,
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
			searchQuery: selectedQuery,
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

	input.signal?.throwIfAborted();
	const downloadResult = await downloadAudio(
		candidate.url,
		input.jobDir,
		input.proxy,
		input.signal,
	);
	if (Result.isError(downloadResult)) return Result.err(downloadResult.error);

	input.signal?.throwIfAborted();
	const probeResult = await probeAndValidate(
		downloadResult.value,
		audioFeatureBackfillConfig.maxDownloadMb * 1024 * 1024,
		input.signal,
	);
	if (Result.isError(probeResult)) return Result.err(probeResult.error);

	input.signal?.throwIfAborted();
	const clipsResult = await extractClips(
		downloadResult.value,
		probeResult.value.durationSeconds,
		input.jobDir,
		audioFeatureBackfillConfig,
		input.signal,
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
