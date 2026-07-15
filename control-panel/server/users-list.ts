import { read } from "./db";
import { parseListQuery, type ListQuery, type PageResult } from "./query-params";

export interface UserRow {
	id: string;
	label: string;
	handle: string | null;
	email: string | null;
	emailVerified: boolean;
	createdAt: string;
	lastSeenAt: string | null;
	onboardingStep: string | null;
	onboarded: boolean;
	liked: number;
	playlists: number;
	unlocks: number;
	plan: string | null;
	unlimited: boolean;
}

export type UserSort =
	| "createdAt"
	| "lastSeenAt"
	| "liked"
	| "playlists"
	| "unlocks"
	| "label";

const USER_SORTS = [
	"createdAt",
	"lastSeenAt",
	"liked",
	"playlists",
	"unlocks",
	"label",
] as const satisfies readonly UserSort[];

const USER_SORT_SQL: Record<UserSort, string> = {
	createdAt: "a.created_at",
	lastSeenAt: "act.last_seen_at",
	liked: "coalesce(lk.liked, 0)",
	playlists: "coalesce(pl.playlists, 0)",
	unlocks: "coalesce(un.unlocks, 0)",
	label: "coalesce(a.display_name, a.email, a.handle, a.id::text)",
};

function addParam(params: unknown[], value: unknown): string {
	params.push(value);
	return `$${params.length}`;
}

function isUuid(value: string): boolean {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function escapeLike(value: string): string {
	return value.replace(/([\\%_])/g, "\\$1");
}

export interface UsersListQuery extends ListQuery<UserSort> {
	plan: string | null;
	access: "unlimited" | "limited" | "all";
	library: "synced" | "none" | "all";
	onboarding: "complete" | "incomplete" | "not_started" | "all";
	joinedFrom: string | null;
	joinedTo: string | null;
	lastSeen: "24h" | "7d" | "30d" | "inactive_30d" | "never" | "all";
}

export function parseUsersListQuery(url: URL): UsersListQuery {
	const base = parseListQuery(url, USER_SORTS, "createdAt");
	const access = url.searchParams.get("access");
	const library = url.searchParams.get("library");
	const onboarding = url.searchParams.get("onboarding");
	const lastSeen = url.searchParams.get("lastSeen");
	return {
		...base,
		plan: url.searchParams.get("plan")?.trim() || null,
		access: access === "unlimited" || access === "limited" ? access : "all",
		library: library === "synced" || library === "none" ? library : "all",
		onboarding:
			onboarding === "complete" || onboarding === "incomplete" || onboarding === "not_started"
				? onboarding
				: "all",
		joinedFrom: url.searchParams.get("joinedFrom") || null,
		joinedTo: url.searchParams.get("joinedTo") || null,
		lastSeen:
			lastSeen === "24h" ||
			lastSeen === "7d" ||
			lastSeen === "30d" ||
			lastSeen === "inactive_30d" ||
			lastSeen === "never"
				? lastSeen
				: "all",
	};
}

export function whereForUsers(query: UsersListQuery, params: unknown[]): string[] {
	const where: string[] = [];
	if (query.q) {
		const value = addParam(params, query.q);
		const pattern = addParam(params, `%${escapeLike(query.q)}%`);
		const search = isUuid(query.q)
			? `(a.id = ${value} or a.email ilike ${pattern} or coalesce(a.display_name, '') ilike ${pattern} or coalesce(a.handle, '') ilike ${pattern})`
			: `(a.email ilike ${pattern} or coalesce(a.display_name, '') ilike ${pattern} or coalesce(a.handle, '') ilike ${pattern})`;
		where.push(search);
	}
	if (query.plan) where.push(`b.plan = ${addParam(params, query.plan)}`);
	if (query.access === "unlimited") {
		where.push("(b.unlimited_access_source = 'self_hosted' or (b.unlimited_access_source = 'subscription' and b.subscription_status = 'active'))");
	} else if (query.access === "limited") {
		where.push("not (b.unlimited_access_source = 'self_hosted' or (b.unlimited_access_source = 'subscription' and b.subscription_status = 'active'))");
	}
	if (query.library === "synced") where.push("exists (select 1 from liked_song ls where ls.account_id = a.id and ls.unliked_at is null)");
	if (query.library === "none") where.push("not exists (select 1 from liked_song ls where ls.account_id = a.id and ls.unliked_at is null)");
	if (query.onboarding === "complete") where.push("p.onboarding_completed_at is not null");
	if (query.onboarding === "incomplete") where.push("p.onboarding_completed_at is null and p.onboarding_step is not null");
	if (query.onboarding === "not_started") where.push("p.onboarding_step is null");
	if (query.joinedFrom) where.push(`a.created_at >= ${addParam(params, query.joinedFrom)}`);
	if (query.joinedTo) where.push(`a.created_at < ${addParam(params, query.joinedTo)}`);
	if (query.lastSeen === "never") where.push("act.last_seen_at is null");
	if (query.lastSeen === "inactive_30d") where.push("act.last_seen_at < now() - interval '30 days'");
	if (query.lastSeen === "24h") where.push("act.last_seen_at >= now() - interval '24 hours'");
	if (query.lastSeen === "7d") where.push("act.last_seen_at >= now() - interval '7 days'");
	if (query.lastSeen === "30d") where.push("act.last_seen_at >= now() - interval '30 days'");
	return where;
}

export const USER_FROM = `
	from account a
	left join account_activity act on act.account_id = a.id
	left join user_preferences p on p.account_id = a.id
	left join (select account_id, count(*) as liked from liked_song where unliked_at is null group by 1) lk on lk.account_id = a.id
	left join (select account_id, count(*) as playlists from playlist group by 1) pl on pl.account_id = a.id
	left join (select account_id, count(*) as unlocks from account_song_unlock where revoked_at is null group by 1) un on un.account_id = a.id
	left join account_billing b on b.account_id = a.id
	left join "user" u on u.id = a.better_auth_user_id
`;

function mapUser(r: Record<string, unknown>): UserRow {
	return {
		id: String(r.id),
		label: String(r.display_name || r.email || r.handle || r.id),
		handle: r.handle ? String(r.handle) : null,
		email: r.email ? String(r.email) : null,
		emailVerified: Boolean(r.email_verified),
		createdAt: String(r.created_at),
		lastSeenAt: r.last_seen_at ? String(r.last_seen_at) : null,
		onboardingStep: r.onboarding_step ? String(r.onboarding_step) : null,
		onboarded: Boolean(r.onboarded),
		liked: Number(r.liked ?? 0),
		playlists: Number(r.playlists ?? 0),
		unlocks: Number(r.unlocks ?? 0),
		plan: r.plan ? String(r.plan) : null,
		unlimited: Boolean(r.unlimited),
	};
}

export async function usersListPage(url: URL): Promise<PageResult<UserRow>> {
	const query = parseUsersListQuery(url);
	const params: unknown[] = [];
	const where = whereForUsers(query, params);
	const predicate = where.length > 0 ? `where ${where.join(" and ")}` : "";
	const countRows = await read<{ total: string }>(`select count(*) as total ${USER_FROM} ${predicate}`, params);
	const total = Number(countRows[0]?.total ?? 0);
	const offset = (query.page - 1) * query.pageSize;
	const rowsParams = [...params, query.pageSize, offset];
	const rows = await read(`
		select a.id, a.email, a.handle, a.display_name,
			to_char(a.created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') as created_at,
			to_char(act.last_seen_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') as last_seen_at,
			p.onboarding_step, (p.onboarding_completed_at is not null) as onboarded,
			coalesce(lk.liked, 0) as liked, coalesce(pl.playlists, 0) as playlists,
			coalesce(un.unlocks, 0) as unlocks, b.plan,
			u.email_verified,
			(b.unlimited_access_source = 'self_hosted' or (b.unlimited_access_source = 'subscription' and b.subscription_status = 'active')) as unlimited
		${USER_FROM} ${predicate}
		order by ${USER_SORT_SQL[query.sort]} ${query.direction}, a.id asc
		limit $${rowsParams.length - 1} offset $${rowsParams.length}
	`, rowsParams);
	return { rows: rows.map((row) => mapUser(row)), total, page: query.page, pageSize: query.pageSize };
}

export async function usersListExport(url: URL): Promise<UserRow[]> {
	const firstUrl = new URL(url);
	firstUrl.searchParams.set("page", "1");
	firstUrl.searchParams.set("pageSize", "100");
	const first = await usersListPage(firstUrl);
	if (first.total > 25_000) throw new RangeError("Export exceeds the 25,000-row cap; narrow the filters and try again.");
	const rows = [...first.rows];
	for (let page = 2; rows.length < first.total; page += 1) {
		const next = new URL(url);
		next.searchParams.set("page", String(page));
		next.searchParams.set("pageSize", "100");
		rows.push(...(await usersListPage(next)).rows);
	}
	return rows;
}
