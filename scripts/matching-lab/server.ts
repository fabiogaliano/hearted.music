/**
 * Matching Lab — standalone Bun server for testing song-to-playlist matching.
 *
 * Serves a polished UI + JSON API against local Supabase data.
 * Uses the real MatchingService so results match production behavior.
 *
 * Usage: bun run scripts/matching-lab/server.ts
 */

declare const Bun: any;

import { createClient } from "@supabase/supabase-js";
import { Result } from "better-result";
import {
	computeAdaptiveWeights,
	DEFAULT_MATCHING_CONFIG,
} from "@/lib/domains/taste/song-matching/config";
import type {
	MatchingSong,
	MatchingPlaylistProfile,
	MatchingAudioFeatures,
} from "@/lib/domains/taste/song-matching/types";
import { createMatchingService } from "@/lib/domains/taste/song-matching/service";
import { EmbeddingService } from "@/lib/domains/enrichment/embeddings/service";
import { createLlmService } from "@/lib/integrations/llm/service";
import { RerankerService } from "@/lib/integrations/reranker/service";
import { createPlaylistProfilingService } from "@/lib/domains/taste/playlist-profiling/service";
import {
	expandPlaylistIntent,
	type ColdStartProfile,
} from "@/lib/domains/taste/playlist-profiling/intent-expansion";
import * as songData from "@/lib/domains/library/songs/queries";
import { loadExclusionSet } from "@/lib/workflows/enrichment-pipeline/stages/matching";
import { rerankMatches } from "@/lib/workflows/enrichment-pipeline/reranking";

const PORT = 3939;

const supabase = createClient(
	"http://127.0.0.1:54321",
	"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU",
);

interface SongRow {
	id: string;
	spotify_id: string;
	name: string;
	artists: string[];
	genres: string[] | null;
	image_url: string | null;
	album_name: string | null;
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
	song_ids: string[] | null;
}

interface LabPlaylistProfile extends PlaylistProfileRow {
	name: string;
	description: string | null;
	accountId: string;
}

interface AccountOption {
	id: string;
	playlistCount: number;
}

function keepLatestPlaylistProfiles<T extends { playlist_id: string }>(
	profiles: T[],
): T[] {
	const latestProfiles: T[] = [];
	const seenPlaylistIds = new Set<string>();
	for (const profile of profiles) {
		if (seenPlaylistIds.has(profile.playlist_id)) continue;
		seenPlaylistIds.add(profile.playlist_id);
		latestProfiles.push(profile);
	}
	return latestProfiles;
}

async function loadAccountOptions(): Promise<AccountOption[]> {
	const { data, error } = await supabase
		.from("playlist")
		.select("account_id")
		.eq("is_destination", true);
	if (error) throw error;

	const counts = new Map<string, number>();
	for (const row of data ?? []) {
		if (!row.account_id) continue;
		counts.set(row.account_id, (counts.get(row.account_id) ?? 0) + 1);
	}

	return [...counts.entries()]
		.map(([id, playlistCount]) => ({ id, playlistCount }))
		.sort((a, b) => a.id.localeCompare(b.id));
}

async function resolveAccountId(
	requestedAccountId?: string,
): Promise<string | undefined> {
	const accounts = await loadAccountOptions();
	if (requestedAccountId && accounts.some((account) => account.id === requestedAccountId)) {
		return requestedAccountId;
	}
	return accounts[0]?.id;
}

async function loadLikedSongIds(accountId: string): Promise<string[]> {
	const { data, error } = await supabase
		.from("liked_song")
		.select("song_id")
		.eq("account_id", accountId)
		.is("unliked_at", null)
		.order("liked_at", { ascending: false })
		.limit(1000);
	if (error) throw error;
	return (data ?? []).map((row) => row.song_id);
}

async function loadSongs(search?: string, accountId?: string) {
	if (!accountId) {
		let query = supabase
			.from("song")
			.select("id, spotify_id, name, artists, genres, image_url, album_name")
			.order("name")
			.limit(1000);

		if (search) {
			query = query.ilike("name", `%${search}%`);
		}

		const { data, error } = await query;
		if (error) throw error;
		return data as SongRow[];
	}

	const likedSongIds = await loadLikedSongIds(accountId);
	if (likedSongIds.length === 0) return [];

	const { data, error } = await supabase
		.from("song")
		.select("id, spotify_id, name, artists, genres, image_url, album_name")
		.in("id", likedSongIds);
	if (error) throw error;

	const likedSongOrder = new Map(likedSongIds.map((id, index) => [id, index]));
	const filtered = (data as SongRow[]).filter((song) => {
		if (!search) return true;
		const normalizedSearch = search.toLowerCase();
		return (
			song.name.toLowerCase().includes(normalizedSearch) ||
			song.artists.join(" ").toLowerCase().includes(normalizedSearch)
		);
	});

	return filtered.sort(
		(a, b) =>
			(likedSongOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
			(likedSongOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER),
	);
}

async function loadAudioFeatures(
	songIds: string[],
): Promise<Map<string, AudioFeatureRow>> {
	if (songIds.length === 0) return new Map();
	const { data, error } = await supabase
		.from("song_audio_feature")
		.select(
			"song_id, energy, valence, danceability, acousticness, instrumentalness, speechiness, liveness, tempo, loudness",
		)
		.in("song_id", songIds);
	if (error) throw error;
	return new Map((data ?? []).map((r) => [r.song_id, r as AudioFeatureRow]));
}

async function loadEmbeddings(
	songIds: string[],
): Promise<Map<string, number[]>> {
	if (songIds.length === 0) return new Map();
	const { data, error } = await supabase
		.from("song_embedding")
		.select("song_id, embedding")
		.in("song_id", songIds);
	if (error) throw error;
	const map = new Map<string, number[]>();
	for (const row of data ?? []) {
		if (row.embedding) {
			const parsed =
				typeof row.embedding === "string"
					? JSON.parse(row.embedding)
					: row.embedding;
			map.set(row.song_id, parsed);
		}
	}
	return map;
}

async function loadPlaylistProfiles(accountId?: string): Promise<LabPlaylistProfile[]> {
	let profileQuery = supabase
		.from("playlist_profile")
		.select(
			"playlist_id, embedding, audio_centroid, genre_distribution, song_count, song_ids",
		)
		.order("updated_at", { ascending: false });
	const { data: profiles, error: pErr } = await profileQuery;
	if (pErr) throw pErr;
	if (!profiles || profiles.length === 0) {
		return [];
	}
	const latestProfiles = keepLatestPlaylistProfiles(profiles);

	const playlistIds = latestProfiles.map((p) => p.playlist_id);
	const { data: playlists, error: plErr } = await supabase
		.from("playlist")
		.select("id, name, description, account_id")
		.in("id", playlistIds);
	if (plErr) throw plErr;

	const nameMap = new Map(
		(playlists ?? []).map((p) => [
			p.id,
			{
				name: p.name,
				description: p.description,
				accountId: p.account_id,
			},
		]),
	);
	return latestProfiles
		.map((p) => ({
			...(p as PlaylistProfileRow),
			name: nameMap.get(p.playlist_id)?.name ?? "Unknown",
			description: nameMap.get(p.playlist_id)?.description ?? null,
			accountId: nameMap.get(p.playlist_id)?.accountId ?? "",
		}))
		.filter((profile) => !accountId || profile.accountId === accountId);
}

async function loadPlaylistProfileById(
	playlistId: string,
): Promise<LabPlaylistProfile | null> {
	const { data: profile, error: profileError } = await supabase
		.from("playlist_profile")
		.select(
			"playlist_id, embedding, audio_centroid, genre_distribution, song_count, song_ids",
		)
		.eq("playlist_id", playlistId)
		.order("updated_at", { ascending: false })
		.limit(1)
		.maybeSingle();
	if (profileError) throw profileError;
	if (!profile) return null;

	const { data: playlist, error: playlistError } = await supabase
		.from("playlist")
		.select("id, name, description, account_id")
		.eq("id", playlistId)
		.maybeSingle();
	if (playlistError) throw playlistError;

	return {
		...(profile as PlaylistProfileRow),
		name: playlist?.name ?? "Unknown",
		description: playlist?.description ?? null,
		accountId: playlist?.account_id ?? "",
	};
}


async function loadDataSummary(accountId?: string) {
	const playlistProfileCount = (await loadPlaylistProfiles(accountId)).length;

	if (!accountId) {
		const [songs, audioFeatures, embeddings, playlistSongs] = await Promise.all([
			supabase.from("song").select("id, genres", { count: "exact" }),
			supabase
				.from("song_audio_feature")
				.select("song_id", { count: "exact", head: true }),
			supabase
				.from("song_embedding")
				.select("song_id", { count: "exact", head: true }),
			supabase
				.from("playlist_song")
				.select("song_id", { count: "exact", head: true }),
		]);

		const songsData = songs.data ?? [];
		const withGenres = songsData.filter(
			(s) => Array.isArray(s.genres) && s.genres.length > 0,
		).length;

		return {
			totalSongs: songs.count ?? 0,
			withGenres,
			withAudioFeatures: audioFeatures.count ?? 0,
			withEmbeddings: embeddings.count ?? 0,
			playlistProfiles: playlistProfileCount,
			playlistSongRows: playlistSongs.count ?? 0,
		};
	}

	const likedSongIds = await loadLikedSongIds(accountId);
	const { data: playlistIdsData } = await supabase
		.from("playlist")
		.select("id")
		.eq("account_id", accountId)
		.eq("is_destination", true);
	const playlistIds = (playlistIdsData ?? []).map((playlist) => playlist.id);

	if (likedSongIds.length === 0) {
		const playlistSongRows = playlistIds.length > 0
			? await supabase
					.from("playlist_song")
					.select("song_id", { count: "exact", head: true })
					.in("playlist_id", playlistIds)
			: { count: 0 };
		return {
			totalSongs: 0,
			withGenres: 0,
			withAudioFeatures: 0,
			withEmbeddings: 0,
			playlistProfiles: playlistProfileCount,
			playlistSongRows: playlistSongRows.count ?? 0,
		};
	}

	const [songs, audioFeatures, embeddings, playlistSongs] = await Promise.all([
		supabase.from("song").select("id, genres").in("id", likedSongIds),
		supabase
			.from("song_audio_feature")
			.select("song_id", { count: "exact", head: true })
			.in("song_id", likedSongIds),
		supabase
			.from("song_embedding")
			.select("song_id", { count: "exact", head: true })
			.in("song_id", likedSongIds),
		playlistIds.length > 0
			? supabase
					.from("playlist_song")
					.select("song_id", { count: "exact", head: true })
					.in("playlist_id", playlistIds)
			: Promise.resolve({ count: 0 }),
	]);

	const songsData = songs.data ?? [];
	const withGenres = songsData.filter(
		(s) => Array.isArray(s.genres) && s.genres.length > 0,
	).length;

	return {
		totalSongs: likedSongIds.length,
		withGenres,
		withAudioFeatures: audioFeatures.count ?? 0,
		withEmbeddings: embeddings.count ?? 0,
		playlistProfiles: playlistProfileCount,
		playlistSongRows: playlistSongs.count ?? 0,
	};
}

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
	profile: PlaylistProfileRow & { name: string },
): MatchingPlaylistProfile {
	let embedding: number[] | null = null;
	if (profile.embedding) {
		embedding =
			typeof profile.embedding === "string"
				? JSON.parse(profile.embedding)
				: profile.embedding;
	}

	return {
		playlistId: profile.playlist_id,
		embedding,
		audioCentroid: (profile.audio_centroid as Record<string, number>) ?? {},
		genreDistribution:
			(profile.genre_distribution as Record<string, number>) ?? {},
	};
}

interface MatchRequest {
	songIds: string[];
	accountId?: string;
	threshold?: number;
}

async function runMatching(req: MatchRequest) {
	const accountId = await resolveAccountId(req.accountId);
	const songs = await loadSongs(undefined, accountId);
	const selectedSongs = songs.filter((s) => req.songIds.includes(s.id));
	if (selectedSongs.length === 0) return { results: [], summary: {} };

	const songIds = selectedSongs.map((s) => s.id);
	const [audioMap, embeddingMap, profiles] = await Promise.all([
		loadAudioFeatures(songIds),
		loadEmbeddings(songIds),
		loadPlaylistProfiles(accountId),
	]);
	if (profiles.length === 0) {
		return {
			results: [],
			summary: {
				accountId,
				matched: 0,
				noMatch: selectedSongs.length,
				excluded: 0,
				reranked: false,
				usedExclusions: false,
				reason: "No playlist profiles for the selected account",
			},
		};
	}

	const matchingSongs = selectedSongs.map((s) =>
		toMatchingSong(s, audioMap.get(s.id)),
	);
	const matchingProfiles = profiles.map(toMatchingProfile);
	const profileById = new Map(
		matchingProfiles.map((profile) => [profile.playlistId, profile]),
	);
	const profileNameMap = new Map(
		profiles.map((p) => [p.playlist_id, p.name]),
	);
	const playlistInfo = profiles.map((p) => ({
		id: p.playlist_id,
		name: p.name,
		description: p.description,
	}));
	const profileMeta = new Map(
		profiles.map((p) => [
			p.playlist_id,
			{
				songCount: p.song_count ?? 0,
				genreCount: Object.keys(p.genre_distribution ?? {}).length,
				audioKeys: Object.keys(p.audio_centroid ?? {}).length,
				hasEmbedding: !!p.embedding,
			},
		]),
	);
	const embeddingService = new EmbeddingService();
	const matchingService = createMatchingService(embeddingService, null, {
		minScoreThreshold: req.threshold ?? DEFAULT_MATCHING_CONFIG.minScoreThreshold,
	});

	const exclusionSet = accountId ? await loadExclusionSet(accountId) : undefined;

	const matchResult = await matchingService.matchBatch(
		matchingSongs,
		matchingProfiles,
		embeddingMap,
		exclusionSet ? { exclusionSet } : undefined,
	);

	if (Result.isError(matchResult)) {
		throw new Error(matchResult.error.message);
	}

	let rerankerService: RerankerService | undefined;
	try {
		rerankerService = new RerankerService();
	} catch {
		// Reranker unavailable in local lab.
	}
	const rerankingAvailable = rerankerService
		? await rerankerService.isAvailable()
		: false;

	if (rerankerService && rerankingAvailable) {
		await rerankMatches(
			matchResult.value.matches,
			matchingSongs,
			playlistInfo,
			rerankerService,
		);
	}

	const results = [];

	for (const song of matchingSongs) {
		const embedding = embeddingMap.get(song.id) ?? null;
		const songRow = selectedSongs.find((s) => s.id === song.id)!;
		const matchResults = (matchResult.value.matches.get(song.id) ?? []).map(
			(match) => {
				const profile = profileById.get(match.playlistId);
				if (!profile) {
					throw new Error(`Missing profile metadata for ${match.playlistId}`);
				}
				const availability = {
					hasEmbedding: !!embedding && !!profile.embedding,
					hasGenres: !!song.genres && song.genres.length > 0,
					hasAudioFeatures:
						!!song.audioFeatures &&
						Object.keys(profile.audioCentroid).length > 0,
				};
				const rawCosine =
					embedding && profile.embedding
						? cosineSim(embedding, profile.embedding)
						: 0;

				return {
					playlistId: match.playlistId,
					playlistName: profileNameMap.get(match.playlistId) ?? "Unknown",
					score: match.score,
					factors: match.factors,
					rawCosine,
					weights: computeAdaptiveWeights(availability),
					availability,
					confidence: match.confidence,
					profileMeta: profileMeta.get(match.playlistId),
				};
			},
		);

		results.push({
			songId: song.id,
			songName: songRow.name,
			artists: songRow.artists,
			imageUrl: songRow.image_url,
			genres: songRow.genres,
			hasAudioFeatures: !!audioMap.get(song.id),
			hasEmbedding: !!embeddingMap.get(song.id),
			matches: matchResults,
		});
	}

	return {
		results,
		summary: {
			accountId,
			matched: matchResult.value.stats.matched,
			noMatch: matchResult.value.stats.noMatch,
			excluded: matchResult.value.stats.excluded,
			reranked: rerankingAvailable && matchResult.value.matches.size > 0,
			usedExclusions: !!exclusionSet,
		},
	};
}

function cosineSim(a: number[], b: number[]): number {
	if (a.length !== b.length) return 0;
	let dot = 0,
		normA = 0,
		normB = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}
	const denom = Math.sqrt(normA) * Math.sqrt(normB);
	return denom === 0 ? 0 : dot / denom;
}

function parseEmbedding(raw: string | number[] | null): number[] | null {
	if (!raw) return null;
	if (Array.isArray(raw)) return raw;
	try {
		return JSON.parse(raw) as number[];
	} catch {
		return null;
	}
}

function computeStats(values: number[]) {
	if (values.length === 0) {
		return { min: 0, max: 0, mean: 0, stdev: 0, p25: 0, p50: 0, p75: 0, count: 0, spread: 0 };
	}
	const sorted = [...values].sort((a, b) => a - b);
	const mean = values.reduce((s, v) => s + v, 0) / values.length;
	const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
	const p = (pct: number) => {
		const idx = (pct / 100) * (sorted.length - 1);
		const lo = Math.floor(idx);
		const hi = Math.ceil(idx);
		return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
	};
	return {
		min: sorted[0],
		max: sorted[sorted.length - 1],
		mean,
		stdev: Math.sqrt(variance),
		p25: p(25),
		p50: p(50),
		p75: p(75),
		count: values.length,
		spread: sorted[sorted.length - 1] - sorted[0],
	};
}

async function runDiagnostics(accountId?: string) {
	let songRows: unknown[] = [];
	if (accountId) {
		const likedSongIds = await loadLikedSongIds(accountId);
		if (likedSongIds.length > 0) {
			const { data } = await supabase
				.from("song_embedding")
				.select("song_id, embedding, song(name, artists)")
				.in("song_id", likedSongIds);
			songRows = (data ?? []) as unknown[];
		}
	} else {
		const { data } = await supabase
			.from("song_embedding")
			.select("song_id, embedding, song(name, artists)");
		songRows = (data ?? []) as unknown[];
	}

	const profileRows = await loadPlaylistProfiles(accountId);

	type SongEmb = { id: string; name: string; embedding: number[] };
	type PlaylistEmb = { id: string; name: string; embedding: number[]; songCount: number };

	const songs: SongEmb[] = (songRows as any[])
		.map((r) => ({
			id: r.song_id,
			name: r.song?.name ?? "Unknown",
			embedding: parseEmbedding(r.embedding),
		}))
		.filter((s): s is SongEmb => s.embedding !== null);

	const playlists: PlaylistEmb[] = profileRows
		.map((r) => ({
			id: r.playlist_id,
			name: r.name,
			embedding: parseEmbedding(r.embedding),
			songCount: r.song_count ?? 0,
		}))
		.filter((p): p is PlaylistEmb => p.embedding !== null);

	if (songs.length === 0 || playlists.length === 0) {
		return { error: "Not enough data", songs: songs.length, playlists: playlists.length };
	}

	const SIMILARITY_BASELINE = 0.5;

	const perPlaylist = playlists.map((playlist) => {
		const rawSims = songs.map((s) => cosineSim(s.embedding, playlist.embedding));
		const normalizedSims = rawSims.map((sim) =>
			Math.max(0, Math.min(1, (sim - SIMILARITY_BASELINE) / (1 - SIMILARITY_BASELINE))),
		);
		return {
			id: playlist.id,
			name: playlist.name,
			songCount: playlist.songCount,
			profileSource: playlist.songCount === 0 ? "cold_start" : "learned",
			raw: computeStats(rawSims),
			normalized: computeStats(normalizedSims),
		};
	});

	// Per-song spread: best - worst across playlists
	const songSpreads = songs.map((song) => {
		const sims = playlists.map((p) => cosineSim(song.embedding, p.embedding));
		const normalized = sims.map((sim) =>
			Math.max(0, Math.min(1, (sim - SIMILARITY_BASELINE) / (1 - SIMILARITY_BASELINE))),
		);
		const maxNorm = Math.max(...normalized);
		const minNorm = Math.min(...normalized);
		const bestIdx = normalized.indexOf(maxNorm);
		const worstIdx = normalized.indexOf(minNorm);
		return {
			name: song.name,
			spread: maxNorm - minNorm,
			best: { score: maxNorm, playlist: playlists[bestIdx]?.name },
			worst: { score: minNorm, playlist: playlists[worstIdx]?.name },
		};
	});
	songSpreads.sort((a, b) => b.spread - a.spread);

	// Inter-playlist similarity
	const interPlaylist: { a: string; b: string; similarity: number }[] = [];
	for (let i = 0; i < playlists.length; i++) {
		for (let j = i + 1; j < playlists.length; j++) {
			interPlaylist.push({
				a: playlists[i].name,
				b: playlists[j].name,
				similarity: cosineSim(playlists[i].embedding, playlists[j].embedding),
			});
		}
	}
	interPlaylist.sort((a, b) => b.similarity - a.similarity);

	// Overall
	const allRaw: number[] = [];
	for (const song of songs) {
		for (const playlist of playlists) {
			allRaw.push(cosineSim(song.embedding, playlist.embedding));
		}
	}
	const allNormalized = allRaw.map((sim) =>
		Math.max(0, Math.min(1, (sim - SIMILARITY_BASELINE) / (1 - SIMILARITY_BASELINE))),
	);

	return {
		songCount: songs.length,
		playlistCount: playlists.length,
		overall: {
			raw: computeStats(allRaw),
			normalized: computeStats(allNormalized),
		},
		perPlaylist,
		songSpreads: {
			top5: songSpreads.slice(0, 5),
			bottom5: songSpreads.slice(-5),
			stats: computeStats(songSpreads.map((s) => s.spread)),
		},
		interPlaylist,
	};
}

async function reprofilePlaylists(accountId?: string) {
	// Clear cached expansions so they get regenerated on next view
	saveExpansions({});

	const embeddingService = new EmbeddingService();

	let llmService;
	try {
		llmService = createLlmService();
	} catch (e) {
		return { error: "Failed to create LLM service", detail: String(e) };
	}

	const profilingService = createPlaylistProfilingService(embeddingService, llmService);

	let playlistQuery = supabase
		.from("playlist")
		.select("id, name, description, account_id")
		.eq("is_destination", true)
		.order("name");
	if (accountId) {
		playlistQuery = playlistQuery.eq("account_id", accountId);
	}
	const { data: playlists, error } = await playlistQuery;

	if (error || !playlists) {
		return { error: "Failed to load playlists", detail: error?.message };
	}

	const results = [];
	for (const playlist of playlists) {
		const { data: playlistSongs } = await supabase
			.from("playlist_song")
			.select("song_id")
			.eq("playlist_id", playlist.id);

		const songIds = (playlistSongs ?? []).map((ps) => ps.song_id);
		const songsResult = songIds.length > 0
			? await songData.getByIds(songIds)
			: Result.ok([]);
		const songs = Result.isOk(songsResult) ? songsResult.value : [];

		const result = await profilingService.computeProfile(playlist.id, songs, {
			name: playlist.name,
			description: playlist.description ?? undefined,
			skipCache: true,
		});

		if (Result.isOk(result)) {
			const p = result.value;
			results.push({
				playlistId: playlist.id,
				name: playlist.name,
				description: playlist.description,
				songCount: songs.length,
				profileSource: songs.length === 0 ? "cold_start" : "learned",
				hasEmbedding: !!p.embedding,
				embeddingDims: p.embedding?.length ?? 0,
				genreCount: Object.keys(p.genreDistribution).length,
				topGenres: Object.entries(p.genreDistribution)
					.sort(([, a], [, b]) => b - a)
					.slice(0, 8)
					.map(([g, c]) => ({ genre: g, count: c })),
				audioCentroidKeys: Object.keys(p.audioCentroid).length,
				audioCentroid: p.audioCentroid,
				status: "ok",
			});
		} else {
			results.push({
				playlistId: playlist.id,
				name: playlist.name,
				songCount: songs.length,
				status: "error",
				error: result.error.message,
			});
		}
	}

	return { playlists: results };
}

const expansionsPath = new URL("./expansions.json", import.meta.url).pathname;

function loadExpansions(): Record<string, ColdStartProfile> {
	try {
		const raw = require("fs").readFileSync(expansionsPath, "utf-8");
		return JSON.parse(raw);
	} catch {
		return {};
	}
}

function saveExpansions(data: Record<string, ColdStartProfile>) {
	require("fs").writeFileSync(expansionsPath, JSON.stringify(data, null, 2));
}

async function getPlaylistExpansion(playlistId: string, accountId?: string) {
	const { data: playlist } = await supabase
		.from("playlist")
		.select("id, name, description, account_id")
		.eq("id", playlistId)
		.single();

	if (!playlist) return { error: "Playlist not found" };
	if (accountId && playlist.account_id !== accountId) {
		return { error: "Playlist not in selected account" };
	}

	const stored = loadExpansions();
	if (stored[playlistId]) {
		return { expansion: stored[playlistId], cached: true };
	}

	let llmService;
	try {
		llmService = createLlmService();
	} catch {
		return { error: "LLM service unavailable (no API key)" };
	}

	const result = await expandPlaylistIntent(
		llmService,
		playlist.name,
		playlist.description ?? undefined,
	);

	if (Result.isError(result)) {
		return { error: "LLM expansion failed: " + result.error.message };
	}

	stored[playlistId] = result.value;
	saveExpansions(stored);
	return { expansion: result.value, cached: false };
}

async function getPlaylistSuggestions(
	playlistId: string,
	limit = 15,
	accountId?: string,
) {
	const targetProfile = await loadPlaylistProfileById(playlistId);
	if (!targetProfile) return { error: "Profile not found" };
	if (accountId && targetProfile.accountId !== accountId) {
		return { error: "Playlist not in selected account" };
	}

	const matchingProfile = toMatchingProfile(targetProfile);

	const songs = await loadSongs(undefined, targetProfile.accountId);
	const songIds = songs.map((s) => s.id);

	// Batch in chunks of 80 to avoid URI-too-long on Supabase REST
	const CHUNK = 80;
	const audioMap = new Map<string, AudioFeatureRow>();
	const embeddingMap = new Map<string, number[]>();
	for (let i = 0; i < songIds.length; i += CHUNK) {
		const chunk = songIds.slice(i, i + CHUNK);
		const [aMap, eMap] = await Promise.all([
			loadAudioFeatures(chunk),
			loadEmbeddings(chunk),
		]);
		for (const [k, v] of aMap) audioMap.set(k, v);
		for (const [k, v] of eMap) embeddingMap.set(k, v);
	}

	const matchingSongs = songs.map((song) =>
		toMatchingSong(song, audioMap.get(song.id)),
	);
	const matchingService = createMatchingService(new EmbeddingService(), null, {
		minScoreThreshold: 0,
		maxResultsPerSong: 1,
	});
	const exclusionSet = await loadExclusionSet(targetProfile.accountId);
	const matchResult = await matchingService.matchBatch(
		matchingSongs,
		[matchingProfile],
		embeddingMap,
		{ exclusionSet },
	);
	if (Result.isError(matchResult)) {
		return { error: matchResult.error.message };
	}

	let rerankerService: RerankerService | undefined;
	try {
		rerankerService = new RerankerService();
	} catch {
		// Reranker unavailable in local lab.
	}

	if (rerankerService && matchResult.value.matches.size > 0) {
		await rerankMatches(
			matchResult.value.matches,
			matchingSongs,
			[
				{
					id: targetProfile.playlist_id,
					name: targetProfile.name,
					description: targetProfile.description,
				},
			],
			rerankerService,
		);
	}

	const suggestions = [];
	for (const song of songs) {
		const result = matchResult.value.matches.get(song.id)?.[0];
		if (!result) continue;

		const matchingSong = matchingSongs.find((candidate) => candidate.id === song.id)!;
		const embedding = embeddingMap.get(song.id) ?? null;
		const availability = {
			hasEmbedding: !!embedding && !!matchingProfile.embedding,
			hasGenres: !!matchingSong.genres && matchingSong.genres.length > 0,
			hasAudioFeatures:
				!!matchingSong.audioFeatures &&
				Object.keys(matchingProfile.audioCentroid).length > 0,
		};

		suggestions.push({
			songId: song.id,
			name: song.name,
			artists: song.artists,
			imageUrl: song.image_url,
			genres: song.genres,
			score: result.score,
			factors: result.factors,
			rawCosine:
				embedding && matchingProfile.embedding
					? cosineSim(embedding, matchingProfile.embedding)
					: 0,
			weights: computeAdaptiveWeights(availability),
		});
	}

	suggestions.sort((a, b) => b.score - a.score);
	return { suggestions: suggestions.slice(0, limit) };
}

const pinsPath = new URL("./pinned-songs.json", import.meta.url).pathname;

function loadPins(): string[] {
	try {
		const raw = require("fs").readFileSync(pinsPath, "utf-8");
		return JSON.parse(raw);
	} catch {
		return [];
	}
}

function savePins(ids: string[]) {
	require("fs").writeFileSync(pinsPath, JSON.stringify(ids, null, 2));
}

const htmlPath = new URL("./index.html", import.meta.url).pathname;

Bun.serve({
	port: PORT,
	idleTimeout: 255,
	async fetch(request: Request) {
		const url = new URL(request.url);

		if (url.pathname === "/" || url.pathname === "/index.html") {
			return new Response(Bun.file(htmlPath), {
				headers: { "content-type": "text/html; charset=utf-8" },
			});
		}

		if (url.pathname === "/api/accounts") {
			const accounts = await loadAccountOptions();
			return Response.json({
				accounts,
				defaultAccountId: accounts[0]?.id ?? null,
			});
		}

		if (url.pathname === "/api/songs") {
			const search = url.searchParams.get("q") ?? undefined;
			const accountId = await resolveAccountId(
				url.searchParams.get("accountId") ?? undefined,
			);
			const songs = await loadSongs(search, accountId);

			const songIds = songs.map((s) => s.id);

			// Batch to avoid URI-too-long on Supabase REST
			const CHUNK = 80;
			const audioMap = new Map<string, AudioFeatureRow>();
			const embeddingMap = new Map<string, number[]>();
			for (let i = 0; i < songIds.length; i += CHUNK) {
				const chunk = songIds.slice(i, i + CHUNK);
				const [aMap, eMap] = await Promise.all([
					loadAudioFeatures(chunk),
					loadEmbeddings(chunk),
				]);
				for (const [k, v] of aMap) audioMap.set(k, v);
				for (const [k, v] of eMap) embeddingMap.set(k, v);
			}

			const enriched = songs.map((s) => ({
				id: s.id,
				name: s.name,
				artists: s.artists,
				genres: s.genres,
				imageUrl: s.image_url,
				albumName: s.album_name,
				hasAudioFeatures: audioMap.has(s.id),
				hasEmbedding: embeddingMap.has(s.id),
			}));

			return Response.json({ accountId, songs: enriched });
		}

		if (url.pathname === "/api/playlists") {
			const accountId = await resolveAccountId(
				url.searchParams.get("accountId") ?? undefined,
			);
			const profiles = await loadPlaylistProfiles(accountId);
			const playlists = profiles.map((p) => ({
				id: p.playlist_id,
				name: p.name,
				description: p.description,
				songCount: p.song_count ?? 0,
				profileSource: (p.song_count ?? 0) === 0 ? "cold_start" : "learned",
				genreDistributionSize: Object.keys(p.genre_distribution ?? {}).length,
				audioCentroidKeys: Object.keys(p.audio_centroid ?? {}).length,
				hasEmbedding: !!p.embedding,
				topGenres: Object.entries(p.genre_distribution ?? {})
					.sort(([, a], [, b]) => b - a)
					.slice(0, 5)
					.map(([genre, count]) => ({ genre, count })),
				audioCentroid: p.audio_centroid,
			}));
			return Response.json({ accountId, playlists });
		}

		if (url.pathname === "/api/summary") {
			const accountId = await resolveAccountId(
				url.searchParams.get("accountId") ?? undefined,
			);
			const summary = await loadDataSummary(accountId);
			return Response.json({ ...summary, accountId });
		}

		if (url.pathname === "/api/pins" && request.method === "GET") {
			return Response.json({ pins: loadPins() });
		}

		if (url.pathname === "/api/pins" && request.method === "POST") {
			const { songId, action } = (await request.json()) as {
				songId: string;
				action: "add" | "remove";
			};
			const pins = loadPins();
			if (action === "add" && !pins.includes(songId)) {
				pins.push(songId);
			} else if (action === "remove") {
				const idx = pins.indexOf(songId);
				if (idx !== -1) pins.splice(idx, 1);
			}
			savePins(pins);
			return Response.json({ pins });
		}

		if (url.pathname === "/api/match" && request.method === "POST") {
			const body = (await request.json()) as MatchRequest;
			const result = await runMatching(body);
			return Response.json(result);
		}

		if (url.pathname === "/api/diagnostics") {
			const accountId = await resolveAccountId(
				url.searchParams.get("accountId") ?? undefined,
			);
			const diagnostics = await runDiagnostics(accountId);
			return Response.json({ ...diagnostics, accountId });
		}

		if (url.pathname === "/api/reprofile" && request.method === "POST") {
			const accountId = await resolveAccountId(
				url.searchParams.get("accountId") ?? undefined,
			);
			const result = await reprofilePlaylists(accountId);
			return Response.json({ ...result, accountId });
		}

		// /api/playlist/:id/expansion
		const expansionMatch = url.pathname.match(/^\/api\/playlist\/([^/]+)\/expansion$/);
		if (expansionMatch) {
			const result = await getPlaylistExpansion(
				expansionMatch[1],
				url.searchParams.get("accountId") ?? undefined,
			);
			return Response.json(result);
		}

		// /api/playlist/:id/suggestions
		const suggestionsMatch = url.pathname.match(/^\/api\/playlist\/([^/]+)\/suggestions$/);
		if (suggestionsMatch) {
			const limit = Number(url.searchParams.get("limit") ?? 15);
			const result = await getPlaylistSuggestions(
				suggestionsMatch[1],
				limit,
				url.searchParams.get("accountId") ?? undefined,
			);
			return Response.json(result);
		}

		return new Response("Not found", { status: 404 });
	},
});

console.log(`\n  ⚡ Matching Lab running at http://localhost:${PORT}\n`);
