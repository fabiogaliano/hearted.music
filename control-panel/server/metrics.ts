/**
 * Prod metric queries.
 *
 * Each exported function returns a typed, JSON-ready shape for one dashboard
 * section. All reads go through the read-only transaction wrapper in db.ts.
 *
 * Enrichment presence is joined via `select distinct song_id` subqueries rather
 * than direct joins: song_analysis / song_embedding / song_lyrics can have many
 * rows per song, and a plain join would fan out and inflate the per-account
 * counts. distinct guarantees at most one match per song.
 */

import { read } from "./db";

const num = (v: unknown): number => Number(v ?? 0);

// ── Users & growth ───────────────────────────────────────────────────────────

export interface UsersMetrics {
	totalAccounts: number;
	signups1d: number;
	signups7d: number;
	signups30d: number;
	accountsWithLibrary: number;
	accountsWithoutLibrary: number;
	waitlistTotal: number;
	signupTrend: { day: string; count: number }[];
}

export async function usersMetrics(): Promise<UsersMetrics> {
	const [[totals], trend] = await Promise.all([
		read(`
		select
			(select count(*) from account) as total_accounts,
			(select count(*) from account where created_at >= now() - interval '1 day') as signups_1d,
			(select count(*) from account where created_at >= now() - interval '7 days') as signups_7d,
			(select count(*) from account where created_at >= now() - interval '30 days') as signups_30d,
			(select count(distinct account_id) from liked_song where unliked_at is null) as accounts_with_library,
			(select count(*) from waitlist) as waitlist_total
	`),
		read(`
		select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day, count(*) as count
		from account
		where created_at >= now() - interval '14 days'
		group by 1 order by 1
	`),
	]);

	const totalAccounts = num(totals?.total_accounts);
	const accountsWithLibrary = num(totals?.accounts_with_library);
	return {
		totalAccounts,
		signups1d: num(totals?.signups_1d),
		signups7d: num(totals?.signups_7d),
		signups30d: num(totals?.signups_30d),
		accountsWithLibrary,
		accountsWithoutLibrary: totalAccounts - accountsWithLibrary,
		waitlistTotal: num(totals?.waitlist_total),
		signupTrend: trend.map((r) => ({
			day: String(r.day),
			count: num(r.count),
		})),
	};
}

// ── Users list (directory) ───────────────────────────────────────────────────

export interface UserRow {
	id: string;
	label: string;
	handle: string | null;
	email: string | null;
	createdAt: string;
	onboardingStep: string | null;
	onboarded: boolean;
	liked: number;
	playlists: number;
	unlocks: number;
	plan: string | null;
	unlimited: boolean;
}

export async function usersList(): Promise<UserRow[]> {
	const rows = await read(`
		select a.id, a.email, a.handle, a.display_name,
			to_char(a.created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') as created_at,
			p.onboarding_step,
			(p.onboarding_completed_at is not null) as onboarded,
			coalesce(lk.liked, 0) as liked,
			coalesce(pl.playlists, 0) as playlists,
			coalesce(un.unlocks, 0) as unlocks,
			b.plan, b.subscription_status, b.unlimited_access_source
		from account a
		left join user_preferences p on p.account_id = a.id
		left join (select account_id, count(*) as liked from liked_song where unliked_at is null group by 1) lk on lk.account_id = a.id
		left join (select account_id, count(*) as playlists from playlist group by 1) pl on pl.account_id = a.id
		left join (select account_id, count(*) as unlocks from account_song_unlock where revoked_at is null group by 1) un on un.account_id = a.id
		left join account_billing b on b.account_id = a.id
		order by a.created_at desc
		limit 500
	`);

	return rows.map((r) => ({
		id: String(r.id),
		label: String(r.display_name || r.email || r.handle || r.id),
		handle: r.handle ? String(r.handle) : null,
		email: r.email ? String(r.email) : null,
		createdAt: String(r.created_at),
		onboardingStep: r.onboarding_step ? String(r.onboarding_step) : null,
		onboarded: Boolean(r.onboarded),
		liked: num(r.liked),
		playlists: num(r.playlists),
		unlocks: num(r.unlocks),
		plan: r.plan ? String(r.plan) : null,
		unlimited:
			r.unlimited_access_source === "self_hosted" ||
			(r.unlimited_access_source === "subscription" &&
				r.subscription_status === "active"),
	}));
}

// ── Library ──────────────────────────────────────────────────────────────────

export interface LibraryMetrics {
	activeLiked: number;
	distinctLibrarySongs: number;
	totalPlaylists: number;
	totalSongs: number;
	distribution: {
		bucket: string;
		accounts: number;
		min: number;
		max: number | null;
	}[];
	topUsers: {
		id: string;
		label: string;
		handle: string | null;
		liked: number;
		playlists: number;
	}[];
}

export async function libraryMetrics(): Promise<LibraryMetrics> {
	const [[totals], [dist], topUsers] = await Promise.all([
		read(`
		select
			(select count(*) from liked_song where unliked_at is null) as active_liked,
			(select count(distinct song_id) from liked_song where unliked_at is null) as distinct_songs,
			(select count(*) from playlist) as total_playlists,
			(select count(*) from song) as total_songs
	`),
		read(`
		with per as (
			select a.id, count(l.id) filter (where l.unliked_at is null) as c
			from account a left join liked_song l on l.account_id = a.id
			group by a.id
		)
		select
			count(*) filter (where c = 0) as b0,
			count(*) filter (where c between 1 and 50) as b1,
			count(*) filter (where c between 51 and 200) as b2,
			count(*) filter (where c between 201 and 500) as b3,
			count(*) filter (where c between 501 and 1000) as b4,
			count(*) filter (where c between 1001 and 2500) as b5,
			count(*) filter (where c between 2501 and 5000) as b6,
			count(*) filter (where c between 5001 and 10000) as b7,
			count(*) filter (where c > 10000) as b8
		from per
	`),
		read(`
		with lk as (
			select account_id, count(*) as liked
			from liked_song where unliked_at is null
			group by account_id
		),
		pl as (
			select account_id, count(*) as playlists
			from playlist group by account_id
		)
		select a.id, a.email, a.handle, a.display_name,
			lk.liked, coalesce(pl.playlists, 0) as playlists
		from lk
		join account a on a.id = lk.account_id
		left join pl on pl.account_id = a.id
		order by lk.liked desc
		limit 25
	`),
	]);

	return {
		activeLiked: num(totals?.active_liked),
		distinctLibrarySongs: num(totals?.distinct_songs),
		totalPlaylists: num(totals?.total_playlists),
		totalSongs: num(totals?.total_songs),
		distribution: [
			{ bucket: "0", accounts: num(dist?.b0), min: 0, max: 0 },
			{ bucket: "1–50", accounts: num(dist?.b1), min: 1, max: 50 },
			{ bucket: "51–200", accounts: num(dist?.b2), min: 51, max: 200 },
			{ bucket: "201–500", accounts: num(dist?.b3), min: 201, max: 500 },
			{ bucket: "501–1k", accounts: num(dist?.b4), min: 501, max: 1000 },
			{ bucket: "1k–2.5k", accounts: num(dist?.b5), min: 1001, max: 2500 },
			{ bucket: "2.5k–5k", accounts: num(dist?.b6), min: 2501, max: 5000 },
			{ bucket: "5k–10k", accounts: num(dist?.b7), min: 5001, max: 10000 },
			{ bucket: "10k+", accounts: num(dist?.b8), min: 10001, max: null },
		],
		topUsers: topUsers.map((r) => ({
			id: String(r.id),
			label: String(r.display_name || r.email || r.handle || r.id),
			handle: r.handle ? String(r.handle) : null,
			liked: num(r.liked),
			playlists: num(r.playlists),
		})),
	};
}

// ── Accounts in a liked-count range (distribution tier drill-in) ─────────────

export interface AccountLikedRow {
	id: string;
	label: string;
	handle: string | null;
	email: string | null;
	liked: number;
	playlists: number;
	createdAt: string;
}

export async function accountsByLiked(
	min: number,
	max: number | null,
): Promise<AccountLikedRow[]> {
	const lo = Number.isFinite(min) ? Math.max(0, Math.floor(min)) : 0;
	const hi = max == null ? null : Math.floor(max);
	const upperClause = hi == null ? "" : "and coalesce(lk.liked, 0) <= $2";

	const rows = await read(
		`
		with lk as (
			select account_id, count(*) as liked
			from liked_song where unliked_at is null
			group by account_id
		),
		pl as (select account_id, count(*) as playlists from playlist group by account_id)
		select a.id, a.email, a.handle, a.display_name,
			coalesce(lk.liked, 0) as liked,
			coalesce(pl.playlists, 0) as playlists,
			to_char(a.created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') as created_at
		from account a
		left join lk on lk.account_id = a.id
		left join pl on pl.account_id = a.id
		where coalesce(lk.liked, 0) >= $1 ${upperClause}
		order by liked desc
		limit 200
	`,
		hi == null ? [lo] : [lo, hi],
	);

	return rows.map((r) => ({
		id: String(r.id),
		label: String(r.display_name || r.email || r.handle || r.id),
		handle: r.handle ? String(r.handle) : null,
		email: r.email ? String(r.email) : null,
		liked: num(r.liked),
		playlists: num(r.playlists),
		createdAt: String(r.created_at),
	}));
}

// ── Enrichment gaps ──────────────────────────────────────────────────────────

export interface EnrichmentMetrics {
	entitledSongs: number;
	missingAudio: number;
	missingLyrics: number;
	missingAnalysis: number;
	missingEmbedding: number;
	analysisCount: number;
	analysisCostUsd: number;
	gapsByUser: {
		id: string;
		label: string;
		handle: string | null;
		entitledSongs: number;
		missingAudio: number;
		missingLyrics: number;
		missingAnalysis: number;
		missingEmbedding: number;
	}[];
}

// Entitlement = active unlock OR account-level unlimited access. This is the
// exact predicate is_account_song_entitled() uses and the set the enrichment
// pipeline processes — so it's the correct denominator for "missing" coverage.
// (account_id, song_id) pairs of entitled, actively-liked songs.
const ENTITLED_PAIRS = `
	with unlimited as (
		select account_id from account_billing
		where unlimited_access_source is not null
			and (unlimited_access_source = 'self_hosted'
				or (unlimited_access_source = 'subscription' and subscription_status = 'active'))
	),
	ent as (
		select l.account_id, l.song_id
		from liked_song l
		where l.unliked_at is null
			and (
				l.account_id in (select account_id from unlimited)
				or exists (
					select 1 from account_song_unlock u
					where u.account_id = l.account_id and u.song_id = l.song_id and u.revoked_at is null
				)
			)
	)
`;

const PRESENCE_JOINS = `
	left join (select distinct song_id from song_audio_feature) f on f.song_id = src.song_id
	left join (select distinct song_id from song_lyrics where fetch_status in ('lyrics', 'instrumental')) ly on ly.song_id = src.song_id
	left join (select distinct song_id from song_analysis) an on an.song_id = src.song_id
	left join (select distinct song_id from song_embedding) e on e.song_id = src.song_id
`;

export async function enrichmentMetrics(): Promise<EnrichmentMetrics> {
	const [[totals], [cost], gapsByUser] = await Promise.all([
		read(`
		${ENTITLED_PAIRS},
		src as (select distinct song_id from ent)
		select
			count(*) as entitled_songs,
			count(*) filter (where f.song_id is null) as missing_audio,
			count(*) filter (where ly.song_id is null) as missing_lyrics,
			count(*) filter (where an.song_id is null) as missing_analysis,
			count(*) filter (where e.song_id is null) as missing_embedding
		from src
		${PRESENCE_JOINS}
	`),
		read(`
		select count(*) as analysis_count, coalesce(sum(cost_usd), 0) as cost_usd
		from song_analysis
	`),
		read(`
		${ENTITLED_PAIRS},
		src as (select account_id, song_id from ent)
		select a.id, a.email, a.handle, a.display_name,
			count(*) as entitled_songs,
			count(*) filter (where f.song_id is null) as missing_audio,
			count(*) filter (where ly.song_id is null) as missing_lyrics,
			count(*) filter (where an.song_id is null) as missing_analysis,
			count(*) filter (where e.song_id is null) as missing_embedding
		from src
		join account a on a.id = src.account_id
		${PRESENCE_JOINS}
		group by a.id
		having count(*) filter (where an.song_id is null) > 0
			or count(*) filter (where f.song_id is null) > 0
			or count(*) filter (where ly.song_id is null) > 0
			or count(*) filter (where e.song_id is null) > 0
		order by missing_analysis desc, entitled_songs desc
		limit 30
	`),
	]);

	return {
		entitledSongs: num(totals?.entitled_songs),
		missingAudio: num(totals?.missing_audio),
		missingLyrics: num(totals?.missing_lyrics),
		missingAnalysis: num(totals?.missing_analysis),
		missingEmbedding: num(totals?.missing_embedding),
		analysisCount: num(cost?.analysis_count),
		analysisCostUsd: Number(cost?.cost_usd ?? 0),
		gapsByUser: gapsByUser.map((r) => ({
			id: String(r.id),
			label: String(r.display_name || r.email || r.handle || r.id),
			handle: r.handle ? String(r.handle) : null,
			entitledSongs: num(r.entitled_songs),
			missingAudio: num(r.missing_audio),
			missingLyrics: num(r.missing_lyrics),
			missingAnalysis: num(r.missing_analysis),
			missingEmbedding: num(r.missing_embedding),
		})),
	};
}

// ── Job health ───────────────────────────────────────────────────────────────

export interface JobMetrics {
	pending: number;
	running: number;
	failed: number;
	completed: number;
	staleRunning: number;
	unresolvedFailures: number;
	oldestPendingSeconds: number | null;
	byType: { type: string; pending: number; running: number; failed: number }[];
	recentFailures: {
		id: string;
		type: string;
		error: string | null;
		updatedAt: string;
	}[];
	failureCodes: { code: string; count: number }[];
}

export async function jobMetrics(): Promise<JobMetrics> {
	const [[totals], byType, recentFailures, failureCodes] = await Promise.all([
		read(`
		select
			count(*) filter (where status = 'pending') as pending,
			count(*) filter (where status = 'running') as running,
			count(*) filter (where status = 'failed') as failed,
			count(*) filter (where status = 'completed') as completed,
			count(*) filter (where status = 'running' and heartbeat_at < now() - interval '5 minutes') as stale_running,
			extract(epoch from (now() - min(created_at) filter (where status = 'pending')))::bigint as oldest_pending_seconds,
			(select count(*) from job_item_failure where resolved_at is null) as unresolved_failures
		from job
	`),
		read(`
		select type,
			count(*) filter (where status = 'pending') as pending,
			count(*) filter (where status = 'running') as running,
			count(*) filter (where status = 'failed') as failed
		from job
		group by type
		having count(*) filter (where status in ('pending','running','failed')) > 0
		order by failed desc, pending desc
	`),
		read(`
		select id, type, error, to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') as updated_at
		from job
		where status = 'failed'
		order by updated_at desc
		limit 15
	`),
		read(`
		select failure_code as code, count(*) as count
		from job_item_failure
		where resolved_at is null
		group by 1 order by 2 desc limit 10
	`),
	]);

	return {
		pending: num(totals?.pending),
		running: num(totals?.running),
		failed: num(totals?.failed),
		completed: num(totals?.completed),
		staleRunning: num(totals?.stale_running),
		unresolvedFailures: num(totals?.unresolved_failures),
		oldestPendingSeconds:
			totals?.oldest_pending_seconds == null
				? null
				: num(totals.oldest_pending_seconds),
		byType: byType.map((r) => ({
			type: String(r.type),
			pending: num(r.pending),
			running: num(r.running),
			failed: num(r.failed),
		})),
		recentFailures: recentFailures.map((r) => ({
			id: String(r.id),
			type: String(r.type),
			error: r.error ? String(r.error) : null,
			updatedAt: String(r.updated_at),
		})),
		failureCodes: failureCodes.map((r) => ({
			code: String(r.code),
			count: num(r.count),
		})),
	};
}

// ── Job item failures (drill-down) ───────────────────────────────────────────

export interface JobFailureItem {
	id: string;
	itemType: string;
	itemId: string;
	itemLabel: string;
	failureCode: string;
	stage: string | null;
	errorMessage: string | null;
	isTerminal: boolean;
	createdAt: string;
	accountId: string | null;
	accountLabel: string | null;
	accountHandle: string | null;
}

export async function jobFailures(): Promise<JobFailureItem[]> {
	const rows = await read(`
		select f.id, f.item_type, f.item_id, f.failure_code, f.stage,
			f.error_message, f.is_terminal,
			to_char(f.created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') as created_at,
			j.account_id, a.display_name, a.handle, a.email,
			s.name as song_name, array_to_string(s.artists, ', ') as song_artist
		from job_item_failure f
		left join job j on j.id = f.job_id
		left join account a on a.id = j.account_id
		left join song s on s.id = f.item_id and f.item_type = 'song'
		where f.resolved_at is null
		order by f.created_at desc
		limit 200
	`);

	return rows.map((r) => {
		const songName = r.song_name ? String(r.song_name) : null;
		const itemLabel = songName
			? r.song_artist
				? `${songName} — ${r.song_artist}`
				: songName
			: `${String(r.item_type)} ${String(r.item_id).slice(0, 8)}`;
		return {
			id: String(r.id),
			itemType: String(r.item_type),
			itemId: String(r.item_id),
			itemLabel,
			failureCode: String(r.failure_code),
			stage: r.stage ? String(r.stage) : null,
			errorMessage: r.error_message ? String(r.error_message) : null,
			isTerminal: Boolean(r.is_terminal),
			createdAt: String(r.created_at),
			accountId: r.account_id ? String(r.account_id) : null,
			accountLabel: (r.display_name || r.email || r.handle) as string | null,
			accountHandle: r.handle ? String(r.handle) : null,
		};
	});
}

// ── Billing & grants ─────────────────────────────────────────────────────────

export interface BillingMetrics {
	activeSubscriptions: number;
	creditBalanceTotal: number;
	plans: { plan: string; status: string; accounts: number }[];
	grants: {
		total: number;
		applied: number;
		pending: number;
		byOrigin: { origin: string; applied: number; pending: number }[];
	};
}

export async function billingMetrics(): Promise<BillingMetrics> {
	const [[totals], plans, [grantTotals], byOrigin] = await Promise.all([
		read(`
		select
			count(*) filter (where subscription_status not in ('none')) as active_subs,
			coalesce(sum(credit_balance), 0) as credit_total
		from account_billing
	`),
		read(`
		select plan, subscription_status as status, count(*) as accounts
		from account_billing
		group by 1, 2
		order by 3 desc
	`),
		read(`
		select
			count(*) as total,
			count(*) filter (where applied_at is not null) as applied,
			count(*) filter (where applied_at is null) as pending
		from account_liked_song_access_grant
	`),
		read(`
		select origin,
			count(*) filter (where applied_at is not null) as applied,
			count(*) filter (where applied_at is null) as pending
		from account_liked_song_access_grant
		group by 1 order by 1
	`),
	]);

	return {
		activeSubscriptions: num(totals?.active_subs),
		creditBalanceTotal: num(totals?.credit_total),
		plans: plans.map((r) => ({
			plan: String(r.plan),
			status: String(r.status),
			accounts: num(r.accounts),
		})),
		grants: {
			total: num(grantTotals?.total),
			applied: num(grantTotals?.applied),
			pending: num(grantTotals?.pending),
			byOrigin: byOrigin.map((r) => ({
				origin: String(r.origin),
				applied: num(r.applied),
				pending: num(r.pending),
			})),
		},
	};
}

// ── Account search (operation pickers) ───────────────────────────────────────

export interface AccountSearchResult {
	id: string;
	label: string;
	email: string | null;
	handle: string | null;
	activeLiked: number;
}

// Escapes LIKE wildcards so a query's literal `%`/`_` can't widen the match.
function escapeLikePattern(value: string): string {
	return value.replace(/([\\%_])/g, "\\$1");
}

// Verified accounts that already have a synced library (≥1 active liked song),
// so a grant applies immediately rather than going pending. The inner join to
// active liked_song rows is what enforces "has synced library"; its count is the
// active total. Ranked by library size so the most-liked matches surface first.
export async function searchVerifiedAccounts(
	query: string,
	limit = 20,
): Promise<AccountSearchResult[]> {
	const q = query.trim();
	const pattern = `%${escapeLikePattern(q)}%`;
	const cap = Math.min(Math.max(limit, 1), 50);

	const rows = await read(
		`
		select a.id, a.email, a.handle, a.display_name,
			count(l.id) as active_liked
		from account a
		join "user" u on u.id = a.better_auth_user_id
		join liked_song l on l.account_id = a.id and l.unliked_at is null
		where u.email_verified = true
			and (
				$1 = ''
				or a.email ilike $2
				or coalesce(a.display_name, '') ilike $2
				or coalesce(a.handle, '') ilike $2
			)
		group by a.id
		order by active_liked desc, a.email asc
		limit ${cap}
	`,
		[q, pattern],
	);

	return rows.map((r) => ({
		id: String(r.id),
		label: String(r.display_name || r.email || r.handle || r.id),
		email: r.email ? String(r.email) : null,
		handle: r.handle ? String(r.handle) : null,
		activeLiked: num(r.active_liked),
	}));
}

// ── User detail (drill-down) ─────────────────────────────────────────────────

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

export interface UserDetail {
	id: string;
	email: string | null;
	handle: string | null;
	displayName: string | null;
	spotifyId: string | null;
	imageUrl: string | null;
	createdAt: string;
	plan: string | null;
	subscriptionStatus: string | null;
	unlimitedAccessSource: string | null;
	creditBalance: number;
	activeLiked: number;
	totalLikedEver: number;
	playlists: number;
	activeUnlocks: number;
	revokedUnlocks: number;
	entitledSongs: number;
	missingAudio: number;
	missingLyrics: number;
	missingAnalysis: number;
	missingEmbedding: number;
	grant: {
		origin: string;
		appliedAt: string | null;
		requestedBy: string | null;
		note: string | null;
	} | null;
	songs: UserSong[];
}

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function userDetail(accountId: string): Promise<UserDetail | null> {
	if (!UUID_RE.test(accountId)) throw new Error("Invalid account id.");

	const [acct] = await read(
		`
		select a.id, a.email, a.handle, a.display_name, a.spotify_id, a.image_url,
			to_char(a.created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') as created_at,
			b.plan, b.subscription_status, b.unlimited_access_source, b.credit_balance
		from account a
		left join account_billing b on b.account_id = a.id
		where a.id = $1
	`,
		[accountId],
	);
	if (!acct) return null;

	const isUnlimited =
		acct.unlimited_access_source === "self_hosted" ||
		(acct.unlimited_access_source === "subscription" &&
			acct.subscription_status === "active");

	// counts / enrichment / grant / songs are independent — run them together so
	// the detail view waits on the slowest query, not the sum of all four.
	const [[counts], [enrich], [grant], songs] = await Promise.all([
		read(
			`
		select
			(select count(*) from liked_song where account_id = $1 and unliked_at is null) as active_liked,
			(select count(*) from liked_song where account_id = $1) as total_liked,
			(select count(*) from playlist where account_id = $1) as playlists,
			(select count(*) from account_song_unlock where account_id = $1 and revoked_at is null) as active_unlocks,
			(select count(*) from account_song_unlock where account_id = $1 and revoked_at is not null) as revoked_unlocks
	`,
			[accountId],
		),
		// Entitled songs for THIS account: all active likes if unlimited, else
		// only actively-unlocked songs. Coverage is measured against this set.
		read(
			`
		with ent as (
			select l.song_id
			from liked_song l
			where l.account_id = $1 and l.unliked_at is null
				and (
					$2::boolean
					or exists (
						select 1 from account_song_unlock u
						where u.account_id = $1 and u.song_id = l.song_id and u.revoked_at is null
					)
				)
		),
		src as (select distinct song_id from ent)
		select
			count(*) as entitled_songs,
			count(*) filter (where f.song_id is null) as missing_audio,
			count(*) filter (where ly.song_id is null) as missing_lyrics,
			count(*) filter (where an.song_id is null) as missing_analysis,
			count(*) filter (where e.song_id is null) as missing_embedding
		from src
		left join (select distinct song_id from song_audio_feature) f on f.song_id = src.song_id
		left join (select distinct song_id from song_lyrics where fetch_status in ('lyrics', 'instrumental')) ly on ly.song_id = src.song_id
		left join (select distinct song_id from song_analysis) an on an.song_id = src.song_id
		left join (select distinct song_id from song_embedding) e on e.song_id = src.song_id
	`,
			[accountId, isUnlimited],
		),
		read(
			`
		select origin, to_char(applied_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') as applied_at,
			requested_by, note
		from account_liked_song_access_grant where account_id = $1
	`,
			[accountId],
		),
		read(
			`
		select l.song_id, s.name, array_to_string(s.artists, ', ') as artist, s.image_url,
			to_char(l.liked_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') as liked_at,
			exists (select 1 from account_song_unlock u where u.account_id = $1 and u.song_id = l.song_id and u.revoked_at is null) as unlocked,
			exists (select 1 from song_audio_feature f where f.song_id = l.song_id) as has_audio,
			exists (select 1 from song_lyrics ly where ly.song_id = l.song_id and ly.fetch_status in ('lyrics', 'instrumental')) as has_lyrics,
			exists (select 1 from song_analysis an where an.song_id = l.song_id) as has_analysis,
			exists (select 1 from song_embedding e where e.song_id = l.song_id) as has_embedding
		from liked_song l
		join song s on s.id = l.song_id
		where l.account_id = $1 and l.unliked_at is null
		order by l.liked_at desc
		limit 60
	`,
			[accountId],
		),
	]);

	return {
		id: String(acct.id),
		email: acct.email ? String(acct.email) : null,
		handle: acct.handle ? String(acct.handle) : null,
		displayName: acct.display_name ? String(acct.display_name) : null,
		spotifyId: acct.spotify_id ? String(acct.spotify_id) : null,
		imageUrl: acct.image_url ? String(acct.image_url) : null,
		createdAt: String(acct.created_at),
		plan: acct.plan ? String(acct.plan) : null,
		subscriptionStatus: acct.subscription_status
			? String(acct.subscription_status)
			: null,
		unlimitedAccessSource: acct.unlimited_access_source
			? String(acct.unlimited_access_source)
			: null,
		creditBalance: num(acct.credit_balance),
		activeLiked: num(counts?.active_liked),
		totalLikedEver: num(counts?.total_liked),
		playlists: num(counts?.playlists),
		activeUnlocks: num(counts?.active_unlocks),
		revokedUnlocks: num(counts?.revoked_unlocks),
		entitledSongs: num(enrich?.entitled_songs),
		missingAudio: num(enrich?.missing_audio),
		missingLyrics: num(enrich?.missing_lyrics),
		missingAnalysis: num(enrich?.missing_analysis),
		missingEmbedding: num(enrich?.missing_embedding),
		grant: grant
			? {
					origin: String(grant.origin),
					appliedAt: grant.applied_at ? String(grant.applied_at) : null,
					requestedBy: grant.requested_by ? String(grant.requested_by) : null,
					note: grant.note ? String(grant.note) : null,
				}
			: null,
		songs: songs.map((r) => ({
			songId: String(r.song_id),
			name: String(r.name),
			artist: r.artist ? String(r.artist) : "Unknown",
			imageUrl: r.image_url ? String(r.image_url) : null,
			likedAt: String(r.liked_at),
			unlocked: Boolean(r.unlocked),
			hasAudio: Boolean(r.has_audio),
			hasLyrics: Boolean(r.has_lyrics),
			hasAnalysis: Boolean(r.has_analysis),
			hasEmbedding: Boolean(r.has_embedding),
		})),
	};
}
