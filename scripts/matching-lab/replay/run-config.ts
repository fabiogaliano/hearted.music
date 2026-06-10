/**
 * run-config.ts — Pipeline replay engine for the offline replay runner.
 *
 * Mirrors the server.ts pattern: loads inputs once per account from local
 * Supabase, runs the real MatchingService + RerankerService under a variant
 * config, and returns per-decided-pair ranks.
 *
 * Key design choices (logged in claudedocs/decisions/phase1-runner.md):
 *
 * - No exclusion set: decided pairs are exactly the ones production excluded,
 *   so we must score them without filtering.
 *
 * - Song set: union of (entitled/liked songs) ∪ (all decided songs).  This
 *   guarantees every decided pair is scoreable even if the song is no longer
 *   in the liked set.  The full union is used for normalization so stats are
 *   representative of the same candidate distribution the reranker sees.
 *
 * - Rank definition: after matching (+optional rerank), we group all
 *   (songId, playlistId, score) tuples by playlistId, sort by score desc,
 *   and assign rank 1..n.  A decided pair's rank = its song's position in its
 *   playlist's list, or null if the song didn't appear (fell below threshold).
 *   With the dev account's ~1 playlist and maxResultsPerSong=10 default, no
 *   per-song truncation fires at this scale — all above-threshold songs appear.
 *
 * - Embeddings: loaded from DB; EmbeddingService.create() is still needed by
 *   createMatchingService but is never called for inference (no re-embedding).
 */

import { Result } from "better-result";
import {
  createLocalLabClient,
  parseEmbedding,
} from "../shared";
import type {
  MatchingAudioFeatures,
  MatchingPlaylistProfile,
  MatchingSong,
  MatchingConfig,
  MatchResult,
} from "@/lib/domains/taste/song-matching/types";
import { createMatchingService } from "@/lib/domains/taste/song-matching/service";
import { EmbeddingService } from "@/lib/domains/enrichment/embeddings/service";
import { RerankerService } from "@/lib/integrations/reranker/service";
import { rerankMatches } from "@/lib/workflows/enrichment-pipeline/reranking";
import { flattenAnalysisText } from "@/lib/domains/enrichment/embeddings/analysis-text";
import * as analysisQueries from "@/lib/domains/enrichment/content-analysis/queries";
import type { DecisionRow } from "./load-decisions";

// ---------------------------------------------------------------------------
// Variant config shape
// ---------------------------------------------------------------------------

/** Reranker overrides that can appear in a variant config file */
export interface VariantRerankerConfig {
  enabled?: boolean;
  topN?: number;
  blendWeight?: number;
  minScoreThreshold?: number;
  model?: string;
  instruction?: string;
}

export interface VariantConfig {
  label: string;
  matching?: Partial<MatchingConfig>;
  reranker?: VariantRerankerConfig;
  /** Controls the document fed to the cross-encoder.
   *  "metadata" → name+artists+genres one-liner (pass empty analysisText map).
   *  "analysis"  → prepend analysis prose (pass populated analysisText map).
   */
  documentMode?: "metadata" | "analysis";
}

// ---------------------------------------------------------------------------
// Account inputs (loaded once, shared across variants)
// ---------------------------------------------------------------------------

export interface AccountInputs {
  accountId: string;
  matchingSongs: MatchingSong[];
  matchingProfiles: MatchingPlaylistProfile[];
  embeddingMap: Map<string, number[]>;
  playlistInfo: { id: string; name: string; description: string | null }[];
  decidedSongIds: Set<string>;
}

// ---------------------------------------------------------------------------
// DB row types (local)
// ---------------------------------------------------------------------------

interface SongRow {
  id: string;
  spotify_id: string;
  name: string;
  artists: string[];
  genres: string[] | null;
}

interface AudioFeatureRow {
  song_id: string;
  energy: number | null;
  valence: number | null;
  danceability: number | null;
  acousticness: number | null;
  instrumentalness: number | null;
  speechiness: number | null;
  liveness: number | null;
  tempo: number | null;
  loudness: number | null;
}

interface PlaylistProfileRow {
  playlist_id: string;
  embedding: string | null;
  audio_centroid: Record<string, number> | null;
  genre_distribution: Record<string, number> | null;
  song_count: number | null;
}

// ---------------------------------------------------------------------------
// Helpers (mirrored from server.ts)
// ---------------------------------------------------------------------------

function toMatchingSong(
  song: SongRow,
  audioFeatures: AudioFeatureRow | undefined,
): MatchingSong {
  let af: MatchingAudioFeatures | null = null;
  if (audioFeatures) {
    af = {
      energy: audioFeatures.energy ?? 0,
      valence: audioFeatures.valence ?? 0,
      danceability: audioFeatures.danceability ?? 0,
      acousticness: audioFeatures.acousticness ?? 0,
      instrumentalness: audioFeatures.instrumentalness ?? 0,
      speechiness: audioFeatures.speechiness ?? 0,
      liveness: audioFeatures.liveness ?? 0,
      tempo: audioFeatures.tempo ?? 0,
      loudness: audioFeatures.loudness ?? 0,
    };
  }
  return {
    id: song.id,
    spotifyId: song.spotify_id,
    name: song.name,
    artists: song.artists,
    genres: song.genres,
    audioFeatures: af,
  };
}

function toMatchingProfile(
  profile: PlaylistProfileRow,
): MatchingPlaylistProfile {
  const embedding = parseEmbedding(profile.embedding);
  return {
    playlistId: profile.playlist_id,
    embedding,
    audioCentroid: (profile.audio_centroid as Record<string, number>) ?? {},
    genreDistribution: (profile.genre_distribution as Record<string, number>) ?? {},
  };
}

// Batched loaders (CHUNK=80 to avoid URI-too-long on Supabase REST — same as server.ts)
const CHUNK = 80;

async function loadAudioFeaturesChunked(
  supabase: ReturnType<typeof createLocalLabClient>,
  songIds: string[],
): Promise<Map<string, AudioFeatureRow>> {
  const map = new Map<string, AudioFeatureRow>();
  for (let i = 0; i < songIds.length; i += CHUNK) {
    const chunk = songIds.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("song_audio_feature")
      .select(
        "song_id, energy, valence, danceability, acousticness, instrumentalness, speechiness, liveness, tempo, loudness",
      )
      .in("song_id", chunk);
    if (error) throw new Error(`loadAudioFeatures: ${error.message}`);
    for (const r of data ?? []) map.set(r.song_id, r as AudioFeatureRow);
  }
  return map;
}

async function loadEmbeddingsChunked(
  supabase: ReturnType<typeof createLocalLabClient>,
  songIds: string[],
): Promise<Map<string, number[]>> {
  const map = new Map<string, number[]>();
  for (let i = 0; i < songIds.length; i += CHUNK) {
    const chunk = songIds.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("song_embedding")
      .select("song_id, embedding")
      .in("song_id", chunk);
    if (error) throw new Error(`loadEmbeddings: ${error.message}`);
    for (const r of data ?? []) {
      if (r.embedding) {
        const parsed = parseEmbedding(r.embedding as string | number[]);
        if (parsed) map.set(r.song_id, parsed);
      }
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// loadAccountInputs — loads all data once; shared across variants
// ---------------------------------------------------------------------------

export async function loadAccountInputs(
  accountId: string,
  decisions: DecisionRow[],
): Promise<AccountInputs> {
  const supabase = createLocalLabClient();

  console.log(`  [inputs] Loading account inputs for ${accountId}`);

  // 1. Liked song IDs
  const { data: likedData, error: likedErr } = await supabase
    .from("liked_song")
    .select("song_id")
    .eq("account_id", accountId)
    .is("unliked_at", null)
    .order("liked_at", { ascending: false })
    .limit(5000);
  if (likedErr) throw new Error(`loadLikedSongs: ${likedErr.message}`);

  const likedSongIds = new Set((likedData ?? []).map((r) => r.song_id));

  // 2. Decided song IDs — must always be scoreable
  const decidedSongIds = new Set(decisions.map((d) => d.songId));

  // 3. Union: liked ∪ decided
  const allSongIds = new Set([...likedSongIds, ...decidedSongIds]);
  const songIdList = [...allSongIds];

  console.log(
    `  [inputs] Song set: ${likedSongIds.size} liked + ${decidedSongIds.size} decided → ${songIdList.length} total (after union)`,
  );

  // 4. Load song rows in chunks
  const songRows = new Map<string, SongRow>();
  for (let i = 0; i < songIdList.length; i += CHUNK) {
    const chunk = songIdList.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("song")
      .select("id, spotify_id, name, artists, genres")
      .in("id", chunk);
    if (error) throw new Error(`loadSongs: ${error.message}`);
    for (const r of data ?? []) songRows.set(r.id, r as SongRow);
  }

  // 5. Audio features + embeddings (chunked)
  const [audioMap, embeddingMap] = await Promise.all([
    loadAudioFeaturesChunked(supabase, songIdList),
    loadEmbeddingsChunked(supabase, songIdList),
  ]);

  console.log(
    `  [inputs] Audio features: ${audioMap.size}/${songIdList.length}  Embeddings: ${embeddingMap.size}/${songIdList.length}`,
  );

  // 6. Playlist profiles — load STORED rows (do NOT re-profile)
  const { data: profiles, error: profErr } = await supabase
    .from("playlist_profile")
    .select(
      "playlist_id, embedding, audio_centroid, genre_distribution, song_count, song_ids",
    )
    .order("updated_at", { ascending: false });
  if (profErr) throw new Error(`loadPlaylistProfiles: ${profErr.message}`);

  // Keep latest profile per playlist
  const latestProfiles = new Map<string, PlaylistProfileRow>();
  for (const p of profiles ?? []) {
    if (!latestProfiles.has(p.playlist_id)) {
      latestProfiles.set(p.playlist_id, p as PlaylistProfileRow);
    }
  }

  // Filter to this account's playlists
  const playlistIds = [...latestProfiles.keys()];
  const { data: playlistsData, error: plErr } = await supabase
    .from("playlist")
    .select("id, name, description, account_id")
    .in("id", playlistIds)
    .eq("account_id", accountId);
  if (plErr) throw new Error(`loadPlaylists: ${plErr.message}`);

  const accountPlaylistIds = new Set((playlistsData ?? []).map((p) => p.id));
  const playlistMeta = new Map(
    (playlistsData ?? []).map((p) => [
      p.id,
      { name: p.name as string, description: p.description as string | null },
    ]),
  );

  const accountProfiles = [...latestProfiles.values()].filter((p) =>
    accountPlaylistIds.has(p.playlist_id),
  );

  console.log(`  [inputs] Playlist profiles: ${accountProfiles.length}`);

  // 7. Build MatchingSong[] and MatchingPlaylistProfile[]
  const matchingSongs: MatchingSong[] = songIdList
    .map((id) => songRows.get(id))
    .filter((s): s is SongRow => s !== undefined)
    .map((s) => toMatchingSong(s, audioMap.get(s.id)));

  const matchingProfiles: MatchingPlaylistProfile[] = accountProfiles.map(
    toMatchingProfile,
  );

  const playlistInfo = accountProfiles.map((p) => ({
    id: p.playlist_id,
    name: playlistMeta.get(p.playlist_id)?.name ?? "Unknown",
    description: playlistMeta.get(p.playlist_id)?.description ?? null,
  }));

  return {
    accountId,
    matchingSongs,
    matchingProfiles,
    embeddingMap,
    playlistInfo,
    decidedSongIds,
  };
}

// ---------------------------------------------------------------------------
// deriveDecidedPairRanks — pure, unit-testable
//
// Rank definition: group all MatchResults by playlistId, sort by score desc
// (stable: tie-break by songId asc for reproducibility), assign rank 1..n.
// A decided pair's rank = the song's position in its playlist's ranked list,
// or null if the song did not appear in the matches map for that playlist
// (fell below threshold or was filtered by top-K).
//
// maxResultsPerSong interaction: MatchingService applies maxResultsPerSong
// as a per-SONG top-K (how many playlists each song can match).  With the dev
// account (~1 playlist) and the default cap of 10, this never truncates.
// The rank here is the song's position within a playlist's full scored list
// — a separate dimension from the per-song playlist count.
// ---------------------------------------------------------------------------

export function deriveDecidedPairRanks(
  matches: Map<string, MatchResult[]>,
  decidedPairs: Array<{ songId: string; playlistId: string }>,
): Map<string, number | null> {
  // Build a playlist → [(songId, score)] map from the flat matches structure
  const byPlaylist = new Map<string, { songId: string; score: number }[]>();

  for (const [songId, results] of matches) {
    for (const r of results) {
      const list = byPlaylist.get(r.playlistId) ?? [];
      list.push({ songId, score: r.score });
      byPlaylist.set(r.playlistId, list);
    }
  }

  // Sort each playlist's song list by score desc; tie-break by songId asc
  const playlistRankMaps = new Map<string, Map<string, number>>();
  for (const [playlistId, entries] of byPlaylist) {
    const sorted = entries
      .slice()
      .sort((a, b) => b.score - a.score || a.songId.localeCompare(b.songId));
    const rankMap = new Map<string, number>();
    sorted.forEach((e, i) => rankMap.set(e.songId, i + 1));
    playlistRankMaps.set(playlistId, rankMap);
  }

  // Look up rank for each decided pair
  const result = new Map<string, number | null>();
  for (const pair of decidedPairs) {
    const key = `${pair.songId}:${pair.playlistId}`;
    const rankMap = playlistRankMaps.get(pair.playlistId);
    const rank = rankMap?.get(pair.songId) ?? null;
    result.set(key, rank);
  }

  return result;
}

// ---------------------------------------------------------------------------
// runVariant — run a single variant config against loaded inputs
// ---------------------------------------------------------------------------

export interface VariantResult {
  label: string;
  rankMap: Map<string, number | null>;
}

export async function runVariant(
  inputs: AccountInputs,
  variant: VariantConfig,
  rerankerService: RerankerService | null,
): Promise<VariantResult> {
  console.log(`  [variant:${variant.label}] Starting`);

  // Build EmbeddingService (needed by createMatchingService signature; not used for inference)
  const embResult = EmbeddingService.create();
  if (Result.isError(embResult)) {
    throw new Error(`EmbeddingService.create failed: ${embResult.error.message}`);
  }
  const embeddingService = embResult.value;

  // 1. Create matching service with variant overrides
  const matchingService = createMatchingService(
    embeddingService,
    null,
    variant.matching ?? {},
  );

  // 2. matchBatch — no exclusion set (we must score the decided pairs)
  const matchResult = await matchingService.matchBatch(
    inputs.matchingSongs,
    inputs.matchingProfiles,
    inputs.embeddingMap,
  );

  if (Result.isError(matchResult)) {
    throw new Error(
      `matchBatch failed for variant "${variant.label}": ${matchResult.error.message}`,
    );
  }

  const matches = matchResult.value.matches;
  console.log(
    `  [variant:${variant.label}] Matched: ${matchResult.value.stats.matched} songs, ${matchResult.value.stats.noMatch} no-match`,
  );

  // 3. Reranking (if enabled and available)
  const rerankerEnabled = variant.reranker?.enabled !== false;
  // Strip the `enabled` flag before passing to RerankerService — it's a replay-runner
  // concern, not a RerankerConfig field.
  const { enabled: _enabled, ...rerankerCfg } = variant.reranker ?? {};
  const thisReranker =
    rerankerEnabled && rerankerService
      ? new RerankerService(rerankerCfg)
      : null;

  if (thisReranker) {
    const available = await thisReranker.isAvailable();
    if (available) {
      // Build analysis text map based on documentMode
      const documentMode = variant.documentMode ?? "metadata";
      let analysisText = new Map<string, string>();

      if (documentMode === "analysis") {
        // Collect all song ids that actually appeared in match results
        const matchedSongIds = [...matches.keys()];
        if (matchedSongIds.length > 0) {
          const analysisResult = await analysisQueries.get(matchedSongIds);
          if (Result.isError(analysisResult)) {
            console.warn(
              `  [variant:${variant.label}] Could not load song analyses: ${analysisResult.error.message} — falling back to metadata mode`,
            );
          } else {
            analysisText = new Map<string, string>();
            for (const [songId, analysis] of analysisResult.value) {
              analysisText.set(songId, flattenAnalysisText(analysis));
            }
            console.log(
              `  [variant:${variant.label}] Analysis docs: ${analysisText.size}/${matchedSongIds.length} songs`,
            );
          }
        }
      }

      console.log(
        `  [variant:${variant.label}] Reranking (documentMode=${documentMode}, blendWeight=${thisReranker.getConfig().blendWeight})`,
      );
      await rerankMatches(
        matches,
        inputs.matchingSongs,
        inputs.playlistInfo,
        thisReranker,
        analysisText,
      );
      console.log(`  [variant:${variant.label}] Reranking complete`);
    } else {
      console.warn(
        `  [variant:${variant.label}] Reranker not available (ML_PROVIDER check failed) — running matching-only`,
      );
    }
  } else if (rerankerEnabled && !rerankerService) {
    console.warn(
      `  [variant:${variant.label}] Reranker requested but no shared RerankerService provided`,
    );
  } else {
    console.log(`  [variant:${variant.label}] Reranking disabled by config`);
  }

  // 4. Derive ranks for all (song × playlist) pairs — caller selects the decided subset
  const allPairs = inputs.matchingSongs.flatMap((s) =>
    inputs.playlistInfo.map((p) => ({ songId: s.id, playlistId: p.id })),
  );
  const rankMap = deriveDecidedPairRanks(matches, allPairs);

  return { label: variant.label, rankMap };
}
