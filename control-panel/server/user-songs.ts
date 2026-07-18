import { read } from "./db";
import { parseListQuery, type PageResult } from "./query-params";

export interface UserSong {
	songId: string;
	name: string;
	artist: string;
	imageUrl: string | null;
	likedAt: string;
	unlocked: boolean;
	hasAudio: boolean;
	hasLyrics: boolean;
	hasAnalysis: boolean;
	hasEmbedding: boolean;
}

type SongSort = "likedAt" | "name";
const SORTS = ["likedAt", "name"] as const;
const SORT_SQL: Record<SongSort, string> = { likedAt: "l.liked_at", name: "s.name" };

function escapeLike(value: string): string {
	return value.replace(/([\\%_])/g, "\\$1");
}

export async function userSongsPage(accountId: string, url: URL): Promise<PageResult<UserSong>> {
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(accountId)) {
		throw new Error("Invalid account id.");
	}
	const query = parseListQuery(url, SORTS, "likedAt");
	const params: unknown[] = [accountId];
	const where = ["l.account_id = $1", "l.unliked_at is null"];
	const search = query.q ? `%${escapeLike(query.q)}%` : null;
	if (search) {
		params.push(search);
		where.push(`(s.name ilike $${params.length} or array_to_string(s.artists, ', ') ilike $${params.length})`);
	}
	const access = url.searchParams.get("access");
	if (access === "unlocked") where.push("exists (select 1 from account_song_unlock u where u.account_id = $1 and u.song_id = l.song_id and u.revoked_at is null)");
	if (access === "locked") where.push("not exists (select 1 from account_song_unlock u where u.account_id = $1 and u.song_id = l.song_id and u.revoked_at is null)");
	const stage = url.searchParams.get("missing");
	if (stage === "audio") where.push("not exists (select 1 from song_audio_feature f where f.song_id = l.song_id)");
	if (stage === "lyrics") where.push("not exists (select 1 from song_lyrics ly where ly.song_id = l.song_id and ly.fetch_status in ('lyrics', 'instrumental'))");
	if (stage === "analysis") where.push("not exists (select 1 from song_analysis an where an.song_id = l.song_id)");
	if (stage === "embedding") where.push("not exists (select 1 from song_embedding e where e.song_id = l.song_id)");
	const predicate = where.join(" and ");
	const from = "from liked_song l join song s on s.id = l.song_id";
	const countRows = await read<{ total: string }>(`select count(*) as total ${from} where ${predicate}`, params);
	const total = Number(countRows[0]?.total ?? 0);
	const offset = (query.page - 1) * query.pageSize;
	const rowsParams = [...params, query.pageSize, offset];
	const rows = await read(`
		select l.song_id, s.name, array_to_string(s.artists, ', ') as artist, s.image_url,
			to_char(l.liked_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') as liked_at,
			exists (select 1 from account_song_unlock u where u.account_id = $1 and u.song_id = l.song_id and u.revoked_at is null) as unlocked,
			exists (select 1 from song_audio_feature f where f.song_id = l.song_id) as has_audio,
			exists (select 1 from song_lyrics ly where ly.song_id = l.song_id and ly.fetch_status in ('lyrics', 'instrumental')) as has_lyrics,
			exists (select 1 from song_analysis an where an.song_id = l.song_id) as has_analysis,
			exists (select 1 from song_embedding e where e.song_id = l.song_id) as has_embedding
		${from} where ${predicate}
		order by ${SORT_SQL[query.sort]} ${query.direction}, l.song_id asc
		limit $${rowsParams.length - 1} offset $${rowsParams.length}
	`, rowsParams);
	return {
		rows: rows.map((row) => ({
			songId: String(row.song_id), name: String(row.name), artist: row.artist ? String(row.artist) : "Unknown",
			imageUrl: row.image_url ? String(row.image_url) : null, likedAt: String(row.liked_at),
			unlocked: Boolean(row.unlocked), hasAudio: Boolean(row.has_audio), hasLyrics: Boolean(row.has_lyrics),
			hasAnalysis: Boolean(row.has_analysis), hasEmbedding: Boolean(row.has_embedding),
		})),
		total, page: query.page, pageSize: query.pageSize,
	};
}
