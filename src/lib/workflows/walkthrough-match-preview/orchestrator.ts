/**
 * Walkthrough match preview orchestrator.
 *
 * Onboarding-only path. Scores the chosen demo song against the user's target
 * playlists using the real `MatchingService`, but with `minScoreThreshold: 0`
 * so the walkthrough always returns a ranked list — even when scores are
 * below the production threshold. The preview never publishes a
 * `match_snapshot` and never marks items new.
 */

import { Result } from "better-result";

import { getBatch } from "@/lib/domains/enrichment/audio-features/queries";
import { EmbeddingService } from "@/lib/domains/enrichment/embeddings/service";
import { getById } from "@/lib/domains/library/songs/queries";
import { createPlaylistProfilingService } from "@/lib/domains/taste/playlist-profiling/service";
import { createMatchingService } from "@/lib/domains/taste/song-matching/service";
import type {
	MatchingAudioFeatures,
	MatchingSong,
} from "@/lib/domains/taste/song-matching/types";
import { createLlmService } from "@/lib/integrations/llm/service";
import { loadTargetPlaylistProfiles } from "@/lib/workflows/match-snapshot-refresh/profiles";
import { runLightweightEnrichment } from "@/lib/workflows/playlist-sync/lightweight-enrichment";

import {
	computePreviewFingerprint,
	getWalkthroughPreview,
	markPreviewFailed,
	markPreviewReady,
	type WalkthroughPreviewMatch,
} from "./queries";

const MAX_PREVIEW_RESULTS = 5;

export interface WalkthroughPreviewExecuteResult {
	readonly accountId: string;
	readonly status: "ready" | "skipped" | "failed";
	readonly matchedPlaylists: number;
	readonly fingerprint: string;
}

/**
 * Computes a walkthrough preview for an account and persists the result.
 *
 * "Skipped" outcomes (no demo song, no targets, fingerprint mismatch) are
 * not failures — they reflect the row already being invalidated by a fresh
 * user action. The runner treats them as completed jobs.
 */
export async function executeWalkthroughPreview(
	accountId: string,
): Promise<WalkthroughPreviewExecuteResult> {
	const previewResult = await getWalkthroughPreview(accountId);
	if (Result.isError(previewResult) || !previewResult.value) {
		return {
			accountId,
			status: "skipped",
			matchedPlaylists: 0,
			fingerprint: "",
		};
	}

	const preview = previewResult.value;
	if (!preview.demo_song_id || preview.target_playlist_ids.length === 0) {
		return {
			accountId,
			status: "skipped",
			matchedPlaylists: 0,
			fingerprint: preview.fingerprint,
		};
	}

	const expectedFingerprint = computePreviewFingerprint(
		preview.demo_song_id,
		preview.target_playlist_ids,
	);

	// If a newer pending row replaced this one between job claim and execute,
	// abandon — a fresher job will (or has) taken over.
	if (expectedFingerprint !== preview.fingerprint) {
		return {
			accountId,
			status: "skipped",
			matchedPlaylists: 0,
			fingerprint: preview.fingerprint,
		};
	}

	const embeddingResult = EmbeddingService.create();
	if (Result.isError(embeddingResult)) {
		await markPreviewFailed({
			accountId,
			fingerprint: preview.fingerprint,
			error: `embedding-service-init: ${embeddingResult.error.message}`,
		});
		return {
			accountId,
			status: "failed",
			matchedPlaylists: 0,
			fingerprint: preview.fingerprint,
		};
	}
	const embeddingService = embeddingResult.value;

	let llmService: ReturnType<typeof createLlmService> | undefined;
	try {
		llmService = createLlmService();
	} catch {
		// LLM optional for cold-start expansion; same posture as production refresh.
	}

	const profilingService = createPlaylistProfilingService(
		embeddingService,
		llmService,
	);

	// Backfill the demo song's audio + genre so the matcher has those factors.
	// Its analysis-derived embedding is prefilled offline (demo songs are
	// pre-analyzed via the regular pipeline/scripts), so the runtime preview
	// never runs LLM analysis here. If the embedding is somehow absent, matching
	// proceeds on the remaining factors — the matcher's adaptive weights
	// redistribute around it, so this must not hard-fail.
	try {
		await runLightweightEnrichment({
			accountId,
			songIds: [preview.demo_song_id],
		});
	} catch (err) {
		console.warn(
			`[walkthrough-preview] song prep failed for account=${accountId}:`,
			err,
		);
		// Continue — adaptive weights handle missing factors gracefully.
	}

	const { playlists, profiles } = await loadTargetPlaylistProfiles(
		accountId,
		profilingService,
	);

	if (playlists.length === 0 || profiles.length === 0) {
		// Targets disappeared between ensure() and execute(); short-circuit.
		return {
			accountId,
			status: "skipped",
			matchedPlaylists: 0,
			fingerprint: preview.fingerprint,
		};
	}

	const songResult = await getById(preview.demo_song_id);
	if (Result.isError(songResult) || !songResult.value) {
		await markPreviewFailed({
			accountId,
			fingerprint: preview.fingerprint,
			error: `demo-song-missing: ${preview.demo_song_id}`,
		});
		return {
			accountId,
			status: "failed",
			matchedPlaylists: 0,
			fingerprint: preview.fingerprint,
		};
	}

	const song = songResult.value;
	const audioFeaturesResult = await getBatch([song.id]);
	const audioFeaturesMap = Result.isOk(audioFeaturesResult)
		? audioFeaturesResult.value
		: new Map();
	const audioRow = audioFeaturesMap.get(song.id);
	const audioFeatures: MatchingAudioFeatures | null = audioRow
		? {
				energy: audioRow.energy ?? 0,
				valence: audioRow.valence ?? 0,
				danceability: audioRow.danceability ?? 0,
				acousticness: audioRow.acousticness ?? 0,
				instrumentalness: audioRow.instrumentalness ?? 0,
				speechiness: audioRow.speechiness ?? 0,
				liveness: audioRow.liveness ?? 0,
				tempo: audioRow.tempo ?? 0,
				loudness: audioRow.loudness ?? 0,
			}
		: null;

	const matchingSong: MatchingSong = {
		id: song.id,
		spotifyId: song.spotify_id,
		name: song.name,
		artists: song.artists,
		genres: song.genres,
		audioFeatures,
	};

	let songEmbedding: number[] | null = null;
	const embeddingsResult = await embeddingService.getEmbeddings([song.id]);
	if (Result.isOk(embeddingsResult)) {
		const embeddingRow = embeddingsResult.value.get(song.id);
		if (embeddingRow) {
			const parsed =
				typeof embeddingRow.embedding === "string"
					? JSON.parse(embeddingRow.embedding)
					: embeddingRow.embedding;
			if (Array.isArray(parsed) && parsed.every((v) => typeof v === "number")) {
				songEmbedding = parsed;
			}
		}
	}

	// `minScoreThreshold: 0` is the key onboarding-only deviation. Production
	// matching hides poor candidates; the walkthrough must always show *some*
	// ranking against the user's chosen targets so the demo demonstrates the
	// product instead of returning an empty list.
	const matchingService = createMatchingService(
		embeddingService,
		profilingService,
		{ minScoreThreshold: 0, maxResultsPerSong: MAX_PREVIEW_RESULTS },
	);

	// Restrict scoring to the target playlists captured at ensure() time so
	// later target-set edits made in the background can't sneak into this
	// preview's result. The fingerprint guard on markPreviewReady is the
	// final gate; this filter is just defense-in-depth.
	const targetIds = new Set(preview.target_playlist_ids);
	const scopedProfiles = profiles.filter((p) => targetIds.has(p.playlistId));

	if (scopedProfiles.length === 0) {
		return {
			accountId,
			status: "skipped",
			matchedPlaylists: 0,
			fingerprint: preview.fingerprint,
		};
	}

	const matchResult = await matchingService.matchSong(
		matchingSong,
		scopedProfiles,
		songEmbedding,
	);

	if (Result.isError(matchResult)) {
		await markPreviewFailed({
			accountId,
			fingerprint: preview.fingerprint,
			error: `matching-failed: ${matchResult.error.message}`,
		});
		return {
			accountId,
			status: "failed",
			matchedPlaylists: 0,
			fingerprint: preview.fingerprint,
		};
	}

	const matches: WalkthroughPreviewMatch[] = matchResult.value.map((m) => ({
		playlistId: m.playlistId,
		score: m.score,
		factors: {
			embedding: m.factors.embedding,
			audio: m.factors.audio,
			genre: m.factors.genre,
		},
	}));

	const writeResult = await markPreviewReady({
		accountId,
		fingerprint: preview.fingerprint,
		matches,
	});

	if (Result.isError(writeResult)) {
		// Don't escalate to failure — a concurrent ensure() may have rotated
		// the fingerprint between our match call and the write. The newer job
		// will produce a fresh result.
		console.warn(
			`[walkthrough-preview] write failed for account=${accountId}: ${writeResult.error.message}`,
		);
		return {
			accountId,
			status: "skipped",
			matchedPlaylists: 0,
			fingerprint: preview.fingerprint,
		};
	}

	return {
		accountId,
		status: "ready",
		matchedPlaylists: matches.length,
		fingerprint: preview.fingerprint,
	};
}
