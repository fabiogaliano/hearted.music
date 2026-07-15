import { read } from "./db";
import { parseListQuery, type PageResult } from "./query-params";

export interface EnrichmentAccountRow {
	id: string;
	label: string;
	handle: string | null;
	entitledSongs: number;
	missingAudio: number;
	missingLyrics: number;
	missingAnalysis: number;
	missingEmbedding: number;
	coverage: number;
}

type SortKey = "missingAudio" | "missingLyrics" | "missingAnalysis" | "missingEmbedding" | "entitledSongs" | "coverage" | "label";
const SORTS = ["missingAudio", "missingLyrics", "missingAnalysis", "missingEmbedding", "entitledSongs", "coverage", "label"] as const;
const SORT_SQL: Record<SortKey, string> = {
	missingAudio: "missing_audio", missingLyrics: "missing_lyrics", missingAnalysis: "missing_analysis", missingEmbedding: "missing_embedding", entitledSongs: "entitled_songs", coverage: "coverage", label: "coalesce(display_name, email, handle, id::text)",
};
const ENTITLED_PAIRS = `
	with unlimited as (
		select account_id from account_billing where unlimited_access_source is not null
		and (unlimited_access_source = 'self_hosted' or (unlimited_access_source = 'subscription' and subscription_status = 'active'))
	), ent as (
		select l.account_id, l.song_id from liked_song l where l.unliked_at is null
		and (l.account_id in (select account_id from unlimited) or exists (select 1 from account_song_unlock u where u.account_id = l.account_id and u.song_id = l.song_id and u.revoked_at is null))
	)
`;
const PRESENCE = `
	left join (select distinct song_id from song_audio_feature) f on f.song_id = src.song_id
	left join (select distinct song_id from song_lyrics where fetch_status in ('lyrics', 'instrumental')) ly on ly.song_id = src.song_id
	left join (select distinct song_id from song_analysis) an on an.song_id = src.song_id
	left join (select distinct song_id from song_embedding) e on e.song_id = src.song_id
`;

export async function enrichmentAccountsPage(url: URL): Promise<PageResult<EnrichmentAccountRow>> {
	const query = parseListQuery(url, SORTS, "missingAnalysis");
	const missing = url.searchParams.get("missing");
	const minMissingRaw = Number(url.searchParams.get("minMissing"));
	const minMissing = Number.isInteger(minMissingRaw) && minMissingRaw >= 1 ? minMissingRaw : null;
	const coverageRaw = Number(url.searchParams.get("coverageBelow"));
	const coverageBelow = Number.isFinite(coverageRaw) && coverageRaw >= 0 && coverageRaw <= 100 ? coverageRaw : null;
	const params: unknown[] = [];
	const filters: string[] = [];
	if (query.q) {
		params.push(`%${query.q.replace(/([\\%_])/g, "\\$1")}%`);
		filters.push(`(email ilike $${params.length} or coalesce(display_name, '') ilike $${params.length} or coalesce(handle, '') ilike $${params.length})`);
	}
	const missingSql: Record<string, string> = { audio: "missing_audio", lyrics: "missing_lyrics", analysis: "missing_analysis", embedding: "missing_embedding" };
	if (missing && missingSql[missing]) filters.push(`${missingSql[missing]} > 0`);
	if (minMissing !== null) filters.push("(missing_audio + missing_lyrics + missing_analysis + missing_embedding) >= " + String(minMissing));
	if (coverageBelow !== null) filters.push(`coverage < ${coverageBelow}`);
	const grouped = `
		${ENTITLED_PAIRS}, src as (select account_id, song_id from ent)
		select a.id, a.email, a.handle, a.display_name, count(*) as entitled_songs,
			count(*) filter (where f.song_id is null) as missing_audio,
			count(*) filter (where ly.song_id is null) as missing_lyrics,
			count(*) filter (where an.song_id is null) as missing_analysis,
			count(*) filter (where e.song_id is null) as missing_embedding,
			100.0 * (count(*) - count(*) filter (where f.song_id is null or ly.song_id is null or an.song_id is null or e.song_id is null)) / nullif(count(*), 0) as coverage
		from src join account a on a.id = src.account_id ${PRESENCE}
		group by a.id
		having count(*) filter (where an.song_id is null or f.song_id is null or ly.song_id is null or e.song_id is null) > 0
	`;
	const where = filters.length > 0 ? `where ${filters.join(" and ")}` : "";
	const count = await read<{ total: string }>(`select count(*) as total from (${grouped}) accounts ${where}`, params);
	const total = Number(count[0]?.total ?? 0);
	const offset = (query.page - 1) * query.pageSize;
	const pageParams = [...params, query.pageSize, offset];
	const rows = await read(`select * from (${grouped}) accounts ${where} order by ${SORT_SQL[query.sort]} ${query.direction}, id asc limit $${pageParams.length - 1} offset $${pageParams.length}`, pageParams);
	return { rows: rows.map((row) => ({ id: String(row.id), label: String(row.display_name || row.email || row.handle || row.id), handle: row.handle ? String(row.handle) : null, entitledSongs: Number(row.entitled_songs ?? 0), missingAudio: Number(row.missing_audio ?? 0), missingLyrics: Number(row.missing_lyrics ?? 0), missingAnalysis: Number(row.missing_analysis ?? 0), missingEmbedding: Number(row.missing_embedding ?? 0), coverage: Number(row.coverage ?? 0) })), total, page: query.page, pageSize: query.pageSize };
}
