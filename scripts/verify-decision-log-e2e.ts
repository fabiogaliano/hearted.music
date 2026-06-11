#!/usr/bin/env bun
/**
 * End-to-end verification for decision-log enrichment (matching roadmap #6).
 *
 * Drives the REAL write paths against the live local fixtures, then inspects the
 * rows:
 *   1. A real ADD and DISMISS of surfaced (song, playlist) pairs — exercising the
 *      same served-context resolution the server fn runs (getServedRanksForSong
 *      → served_rank) and the real upsert queries — so the decision rows carry
 *      snapshot_id + served_rank.
 *   2. A real DISMISS of an IMPLICIT pair (a liked song with no match_result in
 *      the snapshot) → snapshot_id set, served_rank NULL — the surfaced-vs-implicit
 *      distinction on live data.
 *   3. A real matching run (live fuse/normalize/rank → real writeMatchSnapshot →
 *      publish RPC) producing a fresh snapshot whose match_result rows carry
 *      normalized_factors + fused_score. The implicit dismiss above grows the
 *      exclusion set, so the snapshot hash changes and the publish is not deduped.
 *
 * Throwaway dev fixtures only. Run: bun scripts/verify-decision-log-e2e.ts
 */

import { Result } from "better-result";
import postgres from "postgres";
import {
	upsertMatchDecision,
	upsertMatchDecisions,
} from "@/lib/domains/taste/song-matching/decision-queries";
import { getServedRanksForSong } from "@/lib/domains/taste/song-matching/queries";
import { createMatchingService } from "@/lib/domains/taste/song-matching/service";
import type {
	MatchingAudioFeatures,
	MatchingPlaylistProfile,
	MatchingSong,
} from "@/lib/domains/taste/song-matching/types";
import { loadExclusionSet } from "@/lib/workflows/enrichment-pipeline/stages/matching";
import { writeMatchSnapshot } from "@/lib/workflows/match-snapshot-refresh/write-match-snapshot";

const sql = postgres("postgresql://postgres:postgres@127.0.0.1:54322/postgres");

/** The server fn's served-rank resolution, run against a real snapshot. */
async function servedRankFor(
	accountId: string,
	snapshotId: string,
	songId: string,
	playlistId: string,
): Promise<number | null> {
	const r = await getServedRanksForSong(snapshotId, accountId, songId);
	if (Result.isError(r) || r.value === null) return null;
	return r.value.find((row) => row.playlist_id === playlistId)?.rank ?? null;
}

async function main(): Promise<void> {
	const [{ id: accountId }] = await sql<{ id: string }[]>`
		SELECT a.id FROM account a
		JOIN match_snapshot ms ON ms.account_id = a.id
		GROUP BY a.id ORDER BY count(ms.id) DESC LIMIT 1
	`;
	const [{ id: playlistId }] = await sql<{ id: string }[]>`
		SELECT id FROM playlist
		WHERE account_id = ${accountId} AND is_target = true LIMIT 1
	`;
	// The snapshot the user actually saw: the most recent one that surfaced
	// results for this playlist (the strictly-latest snapshot may be empty, which
	// no user would have acted on).
	const [{ id: snapshotId }] = await sql<{ id: string }[]>`
		SELECT mr.snapshot_id AS id
		FROM match_result mr
		JOIN match_snapshot ms ON ms.id = mr.snapshot_id
		WHERE ms.account_id = ${accountId} AND mr.playlist_id = ${playlistId}
		GROUP BY mr.snapshot_id, ms.created_at
		ORDER BY ms.created_at DESC LIMIT 1
	`;
	console.log(`account=${accountId}\nsnapshot=${snapshotId}\nplaylist=${playlistId}\n`);

	// Two surfaced songs (have a match_result in this snapshot for this playlist).
	const surfaced = await sql<{ song_id: string; rank: number }[]>`
		SELECT song_id, rank FROM match_result
		WHERE snapshot_id = ${snapshotId} AND playlist_id = ${playlistId}
		ORDER BY rank LIMIT 2
	`;
	// One implicit song (liked, but never surfaced for this playlist + undecided).
	const [implicit] = await sql<{ song_id: string }[]>`
		SELECT ls.song_id FROM liked_song ls
		WHERE ls.account_id = ${accountId} AND ls.unliked_at IS NULL
		  AND NOT EXISTS (
		    SELECT 1 FROM match_result mr
		    WHERE mr.snapshot_id = ${snapshotId} AND mr.song_id = ls.song_id)
		  AND NOT EXISTS (
		    SELECT 1 FROM match_decision md
		    WHERE md.account_id = ${accountId} AND md.song_id = ls.song_id)
		LIMIT 1
	`;
	const [addSong, dismissSurfaced] = surfaced;

	// The implicit song is selected for having no match_result, so its rank
	// resolves to null by construction — passed through servedRankFor anyway to
	// exercise the real query on the implicit path too.
	const [addRank, dismissRank, implicitRank] = await Promise.all([
		servedRankFor(accountId, snapshotId, addSong.song_id, playlistId),
		servedRankFor(accountId, snapshotId, dismissSurfaced.song_id, playlistId),
		servedRankFor(accountId, snapshotId, implicit.song_id, playlistId),
	]);

	// 1. Surfaced ADD.
	await upsertMatchDecision(accountId, addSong.song_id, playlistId, "added", {
		snapshotId,
		servedRank: addRank,
	});

	// 2. Surfaced + implicit DISMISS in one batch (mirrors dismissSong).
	await upsertMatchDecisions([
		{
			accountId,
			songId: dismissSurfaced.song_id,
			playlistId,
			decision: "dismissed",
			snapshotId,
			servedRank: dismissRank,
		},
		{
			accountId,
			songId: implicit.song_id,
			playlistId,
			decision: "dismissed",
			snapshotId,
			servedRank: implicitRank,
		},
	]);

	console.log("=== decision rows (snapshot_id + served_rank) ===");
	const decisions = await sql`
		SELECT song_id, decision, served_rank,
		       (snapshot_id = ${snapshotId}) AS snapshot_linked,
		       CASE WHEN served_rank IS NULL THEN 'implicit' ELSE 'surfaced' END AS kind
		FROM match_decision
		WHERE account_id = ${accountId}
		  AND song_id IN ${sql([
				addSong.song_id,
				dismissSurfaced.song_id,
				implicit.song_id,
			])}
		ORDER BY decision, served_rank NULLS LAST
	`;
	console.table(decisions);

	// 3. Real matching run → fresh snapshot with the new match_result columns.
	const candidateIds = (
		await sql<{ song_id: string }[]>`SELECT song_id FROM song_embedding`
	).map((r) => r.song_id);

	const songRows = await sql<
		{
			id: string;
			spotify_id: string;
			name: string;
			artists: string[];
			genres: string[];
		}[]
	>`SELECT id, spotify_id, name, artists, genres FROM song WHERE id IN ${sql(candidateIds)}`;

	const audioRows = await sql<(MatchingAudioFeatures & { song_id: string })[]>`
		SELECT song_id, energy, valence, danceability, acousticness,
		       instrumentalness, speechiness, liveness, tempo, loudness
		FROM song_audio_feature WHERE song_id IN ${sql(candidateIds)}
	`;
	const audioBySong = new Map(audioRows.map((a) => [a.song_id, a]));

	const embRows = await sql<{ song_id: string; embedding: string }[]>`
		SELECT song_id, embedding::text AS embedding
		FROM song_embedding WHERE song_id IN ${sql(candidateIds)}
	`;
	const embeddings = new Map<string, number[]>(
		embRows.map((e) => [e.song_id, JSON.parse(e.embedding) as number[]]),
	);

	const songs: MatchingSong[] = songRows.map((s) => {
		const af = audioBySong.get(s.id);
		return {
			id: s.id,
			spotifyId: s.spotify_id,
			name: s.name,
			artists: s.artists,
			genres: s.genres,
			audioFeatures: af
				? {
						energy: af.energy,
						valence: af.valence,
						danceability: af.danceability,
						acousticness: af.acousticness,
						instrumentalness: af.instrumentalness,
						speechiness: af.speechiness,
						liveness: af.liveness,
						tempo: af.tempo,
						loudness: af.loudness,
					}
				: null,
		};
	});

	const [profileRow] = await sql<
		{
			playlist_id: string;
			embedding: string | null;
			audio_centroid: Record<string, number> | null;
			genre_distribution: Record<string, number> | null;
		}[]
	>`
		SELECT pp.playlist_id, pp.embedding::text AS embedding,
		       pp.audio_centroid, pp.genre_distribution
		FROM playlist_profile pp
		JOIN playlist p ON p.id = pp.playlist_id
		WHERE p.account_id = ${accountId} AND p.is_target = true
		LIMIT 1
	`;
	const profile: MatchingPlaylistProfile = {
		playlistId: profileRow.playlist_id,
		embedding: profileRow.embedding
			? (JSON.parse(profileRow.embedding) as number[])
			: null,
		audioCentroid: profileRow.audio_centroid ?? {},
		genreDistribution: profileRow.genre_distribution ?? {},
		// E2E verification reads profiles without a genre_pills join;
		// treat as pill-less so scores match the baseline weight set.
		hasGenrePills: false,
	};

	const exclusionSet = await loadExclusionSet(accountId);
	const service = createMatchingService(null, null);
	const matchResult = await service.matchBatch(songs, [profile], embeddings, {
		exclusionSet,
	});
	if (Result.isError(matchResult)) throw new Error("matchBatch failed");

	const results = [];
	for (const [songId, rows] of matchResult.value.matches) {
		for (const r of rows) {
			results.push({
				song_id: songId,
				playlist_id: r.playlistId,
				score: r.score,
				fused_score: r.fusedScore,
				rank: r.rank,
				factors: { ...r.factors },
				normalized_factors: { ...r.normalizedFactors },
			});
		}
	}

	const published = await writeMatchSnapshot({
		accountId,
		songs,
		profiles: [profile],
		results,
		matchedSongIds: [...matchResult.value.matches.keys()],
		exclusionSet,
	});
	console.log(
		`\nmatching run: published=${published.published} noOp=${published.noOp} snapshot=${published.snapshotId} rows=${results.length}`,
	);

	if (published.snapshotId) {
		console.log("\n=== fresh match_result rows (fused_score + normalized_factors) ===");
		const sample = await sql`
			SELECT song_id, score, fused_score, rank, normalized_factors
			FROM match_result
			WHERE snapshot_id = ${published.snapshotId}
			ORDER BY rank LIMIT 3
		`;
		console.table(sample);
		const [{ complete }] = await sql<{ complete: number }[]>`
			SELECT count(*)::int AS complete FROM match_result
			WHERE snapshot_id = ${published.snapshotId}
			  AND fused_score IS NOT NULL
			  AND normalized_factors <> '{}'::jsonb
		`;
		console.log(`rows with both new fields populated: ${complete}/${results.length}`);
	}

	await sql.end();
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
