import { read } from "./db";
import { collectExportPages } from "./export";
import { parseListQuery, type PageResult } from "./query-params";

export interface GrantRow {
	id: string;
	accountId: string;
	accountLabel: string;
	origin: string;
	createdAt: string;
	appliedAt: string | null;
	requestedBy: string | null;
	note: string | null;
	status: "pending" | "applied";
}
export interface SubscriptionRow {
	accountId: string;
	accountLabel: string;
	plan: string | null;
	status: string;
	unlimitedSource: string | null;
	periodEnd: string | null;
	cancelAtPeriodEnd: boolean;
	creditBalance: number;
	syntheticGift: boolean;
}

type GrantSort = "createdAt" | "appliedAt" | "account" | "origin";
const GRANT_SORTS = ["createdAt", "appliedAt", "account", "origin"] as const;
const GRANT_SQL: Record<GrantSort, string> = { createdAt: "g.created_at", appliedAt: "g.applied_at", account: "coalesce(a.display_name, a.email, a.handle, a.id::text)", origin: "g.origin" };
type SubscriptionSort = "account" | "periodEnd" | "status" | "plan";
const SUB_SORTS = ["account", "periodEnd", "status", "plan"] as const;
const SUB_SQL: Record<SubscriptionSort, string> = { account: "coalesce(a.display_name, a.email, a.handle, a.id::text)", periodEnd: "b.subscription_period_end", status: "b.subscription_status", plan: "b.plan" };
function like(value: string): string { return `%${value.replace(/([\\%_])/g, "\\$1")}%`; }

export async function grantsPage(url: URL): Promise<PageResult<GrantRow>> {
	const query = parseListQuery(url, GRANT_SORTS, "createdAt");
	const params: unknown[] = [];
	const where = ["true"];
	if (query.q) { params.push(like(query.q)); where.push(`(a.email ilike $${params.length} or coalesce(a.display_name, '') ilike $${params.length} or coalesce(a.handle, '') ilike $${params.length})`); }
	const status = url.searchParams.get("status");
	if (status === "pending") where.push("g.applied_at is null");
	if (status === "applied") where.push("g.applied_at is not null");
	const origin = url.searchParams.get("origin");
	if (origin) { params.push(origin); where.push(`g.origin = $${params.length}`); }
	const from = "from account_liked_song_access_grant g join account a on a.id = g.account_id";
	const predicate = where.join(" and ");
	const count = await read<{ total: string }>(`select count(*) as total ${from} where ${predicate}`, params);
	const total = Number(count[0]?.total ?? 0);
	const rowParams = [...params, query.pageSize, (query.page - 1) * query.pageSize];
	const rows = await read(`select g.account_id as id, g.account_id, coalesce(a.display_name, a.email, a.handle, a.id::text) as account_label, g.origin, to_char(g.created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') as created_at, to_char(g.applied_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') as applied_at, g.requested_by, g.note ${from} where ${predicate} order by ${GRANT_SQL[query.sort]} ${query.direction} nulls last, g.account_id asc limit $${rowParams.length - 1} offset $${rowParams.length}`, rowParams);
	return { rows: rows.map((r) => ({ id: String(r.id), accountId: String(r.account_id), accountLabel: String(r.account_label), origin: String(r.origin), createdAt: String(r.created_at), appliedAt: r.applied_at ? String(r.applied_at) : null, requestedBy: r.requested_by ? String(r.requested_by) : null, note: r.note ? String(r.note) : null, status: r.applied_at ? "applied" : "pending" })), total, page: query.page, pageSize: query.pageSize };
}

export async function grantsExport(url: URL): Promise<GrantRow[]> {
	const firstUrl = new URL(url);
	firstUrl.searchParams.set("page", "1");
	firstUrl.searchParams.set("pageSize", "100");
	const first = await grantsPage(firstUrl);
	if (first.total > 25_000) throw new RangeError("Export exceeds the 25,000-row cap; narrow the filters and try again.");
	return collectExportPages(first, async (page) => {
		const next = new URL(url);
		next.searchParams.set("page", String(page));
		next.searchParams.set("pageSize", "100");
		return grantsPage(next);
	});
}

export async function subscriptionsExport(url: URL): Promise<SubscriptionRow[]> {
	const firstUrl = new URL(url);
	firstUrl.searchParams.set("page", "1");
	firstUrl.searchParams.set("pageSize", "100");
	const first = await subscriptionsPage(firstUrl);
	if (first.total > 25_000) throw new RangeError("Export exceeds the 25,000-row cap; narrow the filters and try again.");
	return collectExportPages(first, async (page) => {
		const next = new URL(url);
		next.searchParams.set("page", String(page));
		next.searchParams.set("pageSize", "100");
		return subscriptionsPage(next);
	});
}

export async function subscriptionsPage(url: URL): Promise<PageResult<SubscriptionRow>> {
	const query = parseListQuery(url, SUB_SORTS, "account");
	const params: unknown[] = [];
	const where = ["true"];
	if (query.q) { params.push(like(query.q)); where.push(`(a.email ilike $${params.length} or coalesce(a.display_name, '') ilike $${params.length} or coalesce(a.handle, '') ilike $${params.length})`); }
	if (url.searchParams.get("gift") === "synthetic") where.push("b.unlimited_access_source = 'self_hosted'");
	const from = "from account_billing b join account a on a.id = b.account_id";
	const predicate = where.join(" and ");
	const count = await read<{ total: string }>(`select count(*) as total ${from} where ${predicate}`, params);
	const total = Number(count[0]?.total ?? 0);
	const rowParams = [...params, query.pageSize, (query.page - 1) * query.pageSize];
	const rows = await read(`select a.id as account_id, coalesce(a.display_name, a.email, a.handle, a.id::text) as account_label, b.plan, b.subscription_status, b.unlimited_access_source, to_char(b.subscription_period_end, 'YYYY-MM-DD"T"HH24:MI:SSOF') as period_end, b.cancel_at_period_end, b.credit_balance, (b.unlimited_access_source = 'self_hosted') as synthetic_gift ${from} where ${predicate} order by ${SUB_SQL[query.sort]} ${query.direction} nulls last, a.id asc limit $${rowParams.length - 1} offset $${rowParams.length}`, rowParams);
	return { rows: rows.map((r) => ({ accountId: String(r.account_id), accountLabel: String(r.account_label), plan: r.plan ? String(r.plan) : null, status: String(r.subscription_status), unlimitedSource: r.unlimited_access_source ? String(r.unlimited_access_source) : null, periodEnd: r.period_end ? String(r.period_end) : null, cancelAtPeriodEnd: Boolean(r.cancel_at_period_end), creditBalance: Number(r.credit_balance ?? 0), syntheticGift: Boolean(r.synthetic_gift) })), total, page: query.page, pageSize: query.pageSize };
}
