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

async function getFullyEnrichedSongIds(accountId: string): Promise<string[]> {
	const supabase = createAdminSupabaseClient();

	const likedResult = await supabase
		.from("liked_song")
		.select("song_id")
		.eq("account_id", accountId)
		.is("unliked_at", null);

	if (likedResult.error || !likedResult.data) return [];

	const allSongIds = likedResult.data.map((r) => r.song_id);
	if (allSongIds.length === 0) return [];

	const fullyEnriched: string[] = [];

	for (let i = 0; i < allSongIds.length; i += ENRICHMENT_CHUNK) {
		const chunk = allSongIds.slice(i, i + ENRICHMENT_CHUNK);

		const [audioRes, songRes, analysisRes, embeddingRes] = await Promise.all([
			supabase
				.from("song_audio_feature")
				.select("song_id")
				.in("song_id", chunk),
			supabase.from("song").select("id, genres").in("id", chunk),
			supabase.from("song_analysis").select("song_id").in("song_id", chunk),
			supabase.from("song_embedding").select("song_id").in("song_id", chunk),
		]);

		const hasAudio = new Set((audioRes.data ?? []).map((r) => r.song_id));
		const hasGenres = new Set(
			(songRes.data ?? [])
				.filter((r) => r.genres && r.genres.length > 0)
				.map((r) => r.id),
		);
		const hasAnalysis = new Set((analysisRes.data ?? []).map((r) => r.song_id));
		const hasEmbedding = new Set(
			(embeddingRes.data ?? []).map((r) => r.song_id),
		);

		for (const id of chunk) {
			if (
				hasAudio.has(id) &&
				hasGenres.has(id) &&
				hasAnalysis.has(id) &&
				hasEmbedding.has(id)
			) {
				fullyEnriched.push(id);
			}
		}
	}

	return fullyEnriched;
}

export async function selectPipelineBatch(
	accountId: string,
	maxSongs: number,
	excludeSongIds?: string[],
): Promise<PipelineBatch> {
	const supabase = createAdminSupabaseClient();

	const enrichedIds = await getFullyEnrichedSongIds(accountId);

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
