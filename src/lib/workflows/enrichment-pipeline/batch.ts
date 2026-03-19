import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import * as songData from "@/lib/domains/library/songs/queries";
import type { Song } from "@/lib/domains/library/songs/queries";

export interface PipelineBatch {
	readonly songIds: string[];
	readonly songs: Song[];
	readonly spotifyIdBySongId: Map<string, string>;
}

const ENRICHMENT_CHUNK = 200;

async function getSharedArtifactSongIds(
	supabase: ReturnType<typeof createAdminSupabaseClient>,
	chunk: string[],
): Promise<{
	hasAudio: Set<string>;
	hasGenres: Set<string>;
	hasAnalysis: Set<string>;
	hasEmbedding: Set<string>;
}> {
	const [audioRes, songRes, analysisRes, embeddingRes] = await Promise.all([
		supabase.from("song_audio_feature").select("song_id").in("song_id", chunk),
		supabase.from("song").select("id, genres").in("id", chunk),
		supabase.from("song_analysis").select("song_id").in("song_id", chunk),
		supabase.from("song_embedding").select("song_id").in("song_id", chunk),
	]);

	return {
		hasAudio: new Set((audioRes.data ?? []).map((r) => r.song_id)),
		hasGenres: new Set(
			(songRes.data ?? [])
				.filter((r) => r.genres && r.genres.length > 0)
				.map((r) => r.id),
		),
		hasAnalysis: new Set((analysisRes.data ?? []).map((r) => r.song_id)),
		hasEmbedding: new Set((embeddingRes.data ?? []).map((r) => r.song_id)),
	};
}

function hasAllSharedArtifacts(
	id: string,
	artifacts: Awaited<ReturnType<typeof getSharedArtifactSongIds>>,
): boolean {
	return (
		artifacts.hasAudio.has(id) &&
		artifacts.hasGenres.has(id) &&
		artifacts.hasAnalysis.has(id) &&
		artifacts.hasEmbedding.has(id)
	);
}

async function getLikedSongIds(
	supabase: ReturnType<typeof createAdminSupabaseClient>,
	accountId: string,
): Promise<string[]> {
	const likedResult = await supabase
		.from("liked_song")
		.select("song_id")
		.eq("account_id", accountId)
		.is("unliked_at", null);

	if (likedResult.error || !likedResult.data) return [];
	return likedResult.data.map((r) => r.song_id);
}

async function getFullyEnrichedSongIds(accountId: string): Promise<string[]> {
	const supabase = createAdminSupabaseClient();
	const allSongIds = await getLikedSongIds(supabase, accountId);
	if (allSongIds.length === 0) return [];

	const fullyEnriched: string[] = [];

	for (let i = 0; i < allSongIds.length; i += ENRICHMENT_CHUNK) {
		const chunk = allSongIds.slice(i, i + ENRICHMENT_CHUNK);

		const [artifacts, itemStatusRes] = await Promise.all([
			getSharedArtifactSongIds(supabase, chunk),
			supabase
				.from("item_status")
				.select("item_id")
				.eq("account_id", accountId)
				.eq("item_type", "song")
				.in("item_id", chunk),
		]);

		const hasItemStatus = new Set(
			(itemStatusRes.data ?? []).map((r) => r.item_id),
		);

		for (const id of chunk) {
			if (hasAllSharedArtifacts(id, artifacts) && hasItemStatus.has(id)) {
				fullyEnriched.push(id);
			}
		}
	}

	return fullyEnriched;
}

export async function getDataEnrichedSongIds(
	accountId: string,
): Promise<string[]> {
	const supabase = createAdminSupabaseClient();
	const allSongIds = await getLikedSongIds(supabase, accountId);
	if (allSongIds.length === 0) return [];

	const dataEnriched: string[] = [];

	for (let i = 0; i < allSongIds.length; i += ENRICHMENT_CHUNK) {
		const chunk = allSongIds.slice(i, i + ENRICHMENT_CHUNK);
		const artifacts = await getSharedArtifactSongIds(supabase, chunk);

		for (const id of chunk) {
			if (hasAllSharedArtifacts(id, artifacts)) {
				dataEnriched.push(id);
			}
		}
	}

	return dataEnriched;
}

async function buildBatch(
	accountId: string,
	enrichedIds: string[],
	maxSongs: number,
	excludeSongIds?: string[],
): Promise<PipelineBatch> {
	const supabase = createAdminSupabaseClient();

	const allExcluded = new Set<string>(excludeSongIds ?? []);
	for (const id of enrichedIds) {
		allExcluded.add(id);
	}

	let query = supabase
		.from("liked_song")
		.select("song_id, song:song_id(id, spotify_id)")
		.eq("account_id", accountId)
		.is("unliked_at", null)
		.order("liked_at", { ascending: false })
		.limit(maxSongs);

	if (allExcluded.size > 0) {
		query = query.not("song_id", "in", `(${[...allExcluded].join(",")})`);
	}

	const { data, error } = await query;

	if (error) {
		throw new Error(`Failed to query liked songs: ${error.message}`);
	}

	type LikedSongRow = {
		song_id: string;
		song: { id: string; spotify_id: string } | null;
	};
	const rows = (data ?? []) as LikedSongRow[];

	const songIds: string[] = [];
	const spotifyIdBySongId = new Map<string, string>();

	for (const row of rows) {
		if (row.song?.spotify_id) {
			songIds.push(row.song.id);
			spotifyIdBySongId.set(row.song.id, row.song.spotify_id);
		}
	}

	let songs: Song[] = [];
	if (songIds.length > 0) {
		const songsResult = await songData.getByIds(songIds);
		if (Result.isOk(songsResult)) {
			songs = songsResult.value;
		}
	}

	return { songIds, songs, spotifyIdBySongId };
}

export async function selectPipelineBatch(
	accountId: string,
	maxSongs: number,
	excludeSongIds?: string[],
): Promise<PipelineBatch> {
	const enrichedIds = await getFullyEnrichedSongIds(accountId);
	return buildBatch(accountId, enrichedIds, maxSongs, excludeSongIds);
}

export async function selectDataEnrichmentBatch(
	accountId: string,
	maxSongs: number,
	excludeSongIds?: string[],
): Promise<PipelineBatch> {
	const enrichedIds = await getDataEnrichedSongIds(accountId);
	return buildBatch(accountId, enrichedIds, maxSongs, excludeSongIds);
}
