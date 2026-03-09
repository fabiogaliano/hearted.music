import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import * as songData from "@/lib/data/song";
import type { Song } from "@/lib/data/song";

export interface PipelineBatch {
	readonly songIds: string[];
	readonly songs: Song[];
	readonly spotifyIdBySongId: Map<string, string>;
}

export async function selectPipelineBatch(
	accountId: string,
	maxSongs: number,
): Promise<PipelineBatch> {
	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase
		.from("liked_song")
		.select("song_id, song:song_id(id, spotify_id)")
		.eq("account_id", accountId)
		.is("unliked_at", null)
		.order("liked_at", { ascending: false })
		.limit(maxSongs);

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
