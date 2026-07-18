import { read } from "./db";
import { collectExportPages } from "./export";
import { parseListQuery, type PageResult } from "./query-params";

export interface AccountLikedRow {
	id: string;
	label: string;
	handle: string | null;
	email: string | null;
	liked: number;
	playlists: number;
	createdAt: string;
}

type AccountSort = "liked" | "playlists" | "createdAt" | "label";
const SORTS = ["liked", "playlists", "createdAt", "label"] as const;
const SORT_SQL: Record<AccountSort, string> = {
	liked: "coalesce(lk.liked, 0)",
	playlists: "coalesce(pl.playlists, 0)",
	createdAt: "a.created_at",
	label: "coalesce(a.display_name, a.email, a.handle, a.id::text)",
};

function numberParam(url: URL, name: string, fallback: number | null): number | null {
	const raw = url.searchParams.get(name);
	if (raw === null || !/^\d+$/.test(raw)) return fallback;
	const value = Number(raw);
	return Number.isSafeInteger(value) ? value : fallback;
}

function escapeLike(value: string): string {
	return value.replace(/([\\%_])/g, "\\$1");
}

export async function accountsByLikedPage(url: URL): Promise<PageResult<AccountLikedRow>> {
	const query = parseListQuery(url, SORTS, "liked");
	const min = Math.max(0, numberParam(url, "min", 0) ?? 0);
	const max = numberParam(url, "max", null);
	const params: unknown[] = [min];
	const where = ["coalesce(lk.liked, 0) >= $1"];
	if (max !== null && max >= min) {
		params.push(max);
		where.push(`coalesce(lk.liked, 0) <= $${params.length}`);
	}
	if (query.q) {
		params.push(`%${escapeLike(query.q)}%`);
		where.push(`(a.email ilike $${params.length} or coalesce(a.display_name, '') ilike $${params.length} or coalesce(a.handle, '') ilike $${params.length})`);
	}
	const predicate = where.join(" and ");
	const from = `
		from account a
		left join (select account_id, count(*) as liked from liked_song where unliked_at is null group by 1) lk on lk.account_id = a.id
		left join (select account_id, count(*) as playlists from playlist group by 1) pl on pl.account_id = a.id
	`;
	const countRows = await read<{ total: string }>(`select count(*) as total ${from} where ${predicate}`, params);
	const total = Number(countRows[0]?.total ?? 0);
	const offset = (query.page - 1) * query.pageSize;
	const rowsParams = [...params, query.pageSize, offset];
	const rows = await read(`
		select a.id, a.email, a.handle, a.display_name,
			coalesce(lk.liked, 0) as liked, coalesce(pl.playlists, 0) as playlists,
			to_char(a.created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') as created_at
		${from}
		where ${predicate}
		order by ${SORT_SQL[query.sort]} ${query.direction}, a.id asc
		limit $${rowsParams.length - 1} offset $${rowsParams.length}
	`, rowsParams);
	return {
		rows: rows.map((row) => ({
			id: String(row.id),
			label: String(row.display_name || row.email || row.handle || row.id),
			handle: row.handle ? String(row.handle) : null,
			email: row.email ? String(row.email) : null,
			liked: Number(row.liked ?? 0),
			playlists: Number(row.playlists ?? 0),
			createdAt: String(row.created_at),
		})),
		total,
		page: query.page,
		pageSize: query.pageSize,
	};
}

export async function accountsByLikedExport(url: URL): Promise<AccountLikedRow[]> {
	const firstUrl = new URL(url);
	firstUrl.searchParams.set("page", "1");
	firstUrl.searchParams.set("pageSize", "100");
	const first = await accountsByLikedPage(firstUrl);
	if (first.total > 25_000) throw new RangeError("Export exceeds the 25,000-row cap; narrow the filters and try again.");
	return collectExportPages(first, async (page) => {
		const next = new URL(firstUrl);
		next.searchParams.set("page", String(page));
		return accountsByLikedPage(next);
	});
}
