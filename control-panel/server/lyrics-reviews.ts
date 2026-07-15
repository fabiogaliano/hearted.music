/**
 * Lyrics review center — server actions for the control panel.
 *
 * Dropping the Genius page scrape left a cohort of entitled, actively-liked songs
 * with no automated path to lyrics: their latest song_lyrics fetch settled to
 * 'not_found' (all providers came up empty), and a smaller cohort that an old
 * signal classified 'instrumental' (some of those are genre-misclassified vocal
 * tracks). This surface is the manual escape hatch — an operator either types the
 * lyrics or confirms the track is instrumental.
 *
 * Self-contained local SQL, like the release-year / audio review surfaces — no
 * product imports. The two mutations write a song_lyrics row under a dedicated
 * source = 'manual':
 *
 *   - It's a fresh (song_id, source) slot the worker never writes, so it can't
 *     collide with or clobber an automated lrclib/genius/not_found row.
 *   - fetch_source is left NULL (the only honest value — the song_lyrics
 *     fetch_source CHECK permits NULL but forbids 'manual'; the product upsert
 *     helpers couple fetch_source to the provider, so they can't express operator
 *     provenance — hence the direct write here).
 *   - updated_at = now() (default on insert; the song_lyrics_updated_at trigger
 *     bumps it on the ON CONFLICT update path). That alone re-opens the song:
 *     select_liked_song_ids_needing_enrichment_work re-offers needs_analysis when
 *     a 'lyrics' row's updated_at exceeds the latest analysis_created_at, so a
 *     manual lyrics entry triggers reanalysis with no wake and no extra wiring.
 *     A 'manual' instrumental row settles the song (latest fetch_status =
 *     'instrumental' keeps it closed).
 *
 * List is a read-only query; the mutations go through the deliberate read-write
 * transaction helper (db.tx) — never the read-only `read`.
 */

import { read, tx } from "./db";
import { HttpError } from "./http-error";
import {
	type PageResult,
	type PageSize,
	parseQueueQuery,
	type QueueOrder,
} from "./query-params";

export interface LyricsReviewRow {
	songId: string;
	songName: string;
	artistLabel: string;
	albumName: string | null;
	imageUrl: string | null;
	durationMs: number | null;
	fetchStatus: "not_found" | "instrumental";
	fetchSource: string | null;
	fetchUpdatedAt: string;
}

const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));

export function mapRow(r: Record<string, unknown>): LyricsReviewRow {
	return {
		songId: String(r.song_id),
		songName: String(r.song_name ?? ""),
		// artist_label is array_to_string'd in SQL, so we never have to parse the
		// raw text[] literal the type-less pooler driver would otherwise return.
		artistLabel: r.artist_label == null ? "" : String(r.artist_label),
		albumName: r.album_name == null ? null : String(r.album_name),
		imageUrl: r.image_url == null ? null : String(r.image_url),
		durationMs: numOrNull(r.duration_ms),
		fetchStatus: r.fetch_status as LyricsReviewRow["fetchStatus"],
		fetchSource: r.fetch_source == null ? null : String(r.fetch_source),
		fetchUpdatedAt: String(r.fetch_updated_at),
	};
}

export type LyricsFilter = "needs_review" | "instrumental";

// The song carries denormalized album_name/image_url/artists, so "joined to
// song/artist/album" needs no extra joins. The lateral picks the single most
// recent song_lyrics row per song — its fetch_status is what the selector keys
// on. JOIN LATERAL ... ON true also drops songs with no song_lyrics row at all
// (never attempted), which is correct: those aren't manual-review candidates.
const QUEUE_SELECT = `
	select
		s.id as song_id, s.name as song_name,
		array_to_string(s.artists, ', ') as artist_label,
		s.album_name, s.image_url, s.duration_ms,
		latest.fetch_status, latest.fetch_source,
		latest.updated_at as fetch_updated_at
	from public.song s
	join lateral (
		select sl.fetch_status, sl.fetch_source, sl.updated_at
		from public.song_lyrics sl
		where sl.song_id = s.id
		order by sl.updated_at desc
		limit 1
	) latest on true
`;

// Mirrors get_entitled_likers_of_song / the selector's entitlement predicate:
// some account currently likes the song AND is entitled to it (active per-song
// unlock or unlimited access). The queue only shows songs worth an operator's
// time — entitled, still-liked ones.
const HAS_ENTITLED_ACTIVE_LIKER = `exists (
	select 1 from public.liked_song ls
	where ls.song_id = s.id and ls.unliked_at is null
		and (
			exists (
				select 1 from public.account_song_unlock asu
				where asu.account_id = ls.account_id
					and asu.song_id = ls.song_id
					and asu.revoked_at is null
			)
			or exists (
				select 1 from public.account_billing ab
				where ab.account_id = ls.account_id
					and ab.unlimited_access_source is not null
					and (
						ab.unlimited_access_source = 'self_hosted'
						or (
							ab.unlimited_access_source = 'subscription'
							and ab.subscription_status = 'active'
						)
					)
			)
		)
)`;

const FILTER_WHERE: Record<LyricsFilter, string> = {
	// All providers returned nothing — the genuine manual-entry backlog.
	needs_review: "latest.fetch_status = 'not_found'",
	// Settled instrumental — surfaced so an operator can override a
	// genre-misclassified vocal track by entering its lyrics.
	instrumental: "latest.fetch_status = 'instrumental'",
};

function escapeLike(value: string): string {
	return value.replace(/([\\%_])/g, "\\$1");
}

export interface LyricsListParams {
	filter: LyricsFilter;
	q: string;
	order: QueueOrder;
	page: number;
	pageSize: PageSize;
	// Exact provider that produced the latest settle row (e.g. lrclib), or "all".
	source: string;
}

function parseLyricsFilter(value: string | null): LyricsFilter {
	return value === "instrumental" ? "instrumental" : "needs_review";
}

export function parseLyricsQuery(url: URL): LyricsListParams {
	const filter = parseLyricsFilter(url.searchParams.get("filter"));
	// Drain the not-found backlog oldest-first; surface the freshest instrumental
	// (mis)classifications first — matches the historical per-bucket ordering.
	const defaultOrder: QueueOrder = filter === "instrumental" ? "newest" : "oldest";
	const base = parseQueueQuery(url, defaultOrder);
	return {
		filter,
		q: base.q,
		order: base.order,
		page: base.page,
		pageSize: base.pageSize,
		source: url.searchParams.get("source")?.trim() || "all",
	};
}

export async function lyricsReviewsPage(
	url: URL,
): Promise<PageResult<LyricsReviewRow>> {
	const query = parseLyricsQuery(url);
	const params: unknown[] = [];
	const where: string[] = [FILTER_WHERE[query.filter], HAS_ENTITLED_ACTIVE_LIKER];
	if (query.q) {
		params.push(`%${escapeLike(query.q)}%`);
		where.push(
			`(s.name ilike $${params.length} or array_to_string(s.artists, ', ') ilike $${params.length})`,
		);
	}
	if (query.source !== "all") {
		params.push(query.source);
		where.push(`latest.fetch_source = $${params.length}`);
	}
	const predicate = where.join(" and ");
	const direction = query.order === "newest" ? "desc" : "asc";
	const countRows = await read<{ total: string }>(
		`select count(*) as total
		 from public.song s
		 join lateral (
			select sl.fetch_status, sl.fetch_source, sl.updated_at
			from public.song_lyrics sl
			where sl.song_id = s.id
			order by sl.updated_at desc
			limit 1
		 ) latest on true
		 where ${predicate}`,
		params,
	);
	const total = Number(countRows[0]?.total ?? 0);
	const offset = (query.page - 1) * query.pageSize;
	const rowParams = [...params, query.pageSize, offset];
	const rows = await read(
		`${QUEUE_SELECT}
		 where ${predicate}
		 order by latest.updated_at ${direction}, s.id asc
		 limit $${rowParams.length - 1} offset $${rowParams.length}`,
		rowParams,
	);
	return {
		rows: rows.map(mapRow),
		total,
		page: query.page,
		pageSize: query.pageSize,
	};
}

/** Counts the two cohorts the operator drains, scoped to entitled liked songs. */
export async function countLyricsBuckets(): Promise<{
	needsReview: number;
	instrumental: number;
}> {
	const rows = await read<{ needs_review: string; instrumental: string }>(
		`select
			count(*) filter (where latest.fetch_status = 'not_found')::text as needs_review,
			count(*) filter (where latest.fetch_status = 'instrumental')::text as instrumental
		 from public.song s
		 join lateral (
			select sl.fetch_status, sl.updated_at
			from public.song_lyrics sl
			where sl.song_id = s.id
			order by sl.updated_at desc
			limit 1
		 ) latest on true
		 where latest.fetch_status in ('not_found', 'instrumental')
			and ${HAS_ENTITLED_ACTIVE_LIKER}`,
	);
	return {
		needsReview: Number(rows[0]?.needs_review ?? 0),
		instrumental: Number(rows[0]?.instrumental ?? 0),
	};
}

// ─── Manual lyrics document construction ─────────────────────────────────────

const LYRICS_SCHEMA_VERSION = 1;
// Sentinel for non-lyrics (instrumental) rows — matches the worker's queries.ts.
const NO_CONTENT_HASH = "no-content";
const NO_CONTENT_SCHEMA_VERSION = 0;
// Dedicated provenance slot. Distinct from any provider source the worker writes,
// so a manual entry never collides with an automated lrclib/genius/not_found row.
const MANUAL_SOURCE = "manual";

interface LyricsDocument {
	schemaVersion: number;
	source: string;
	sections: { type: string; lines: { id: number; text: string }[] }[];
}

/**
 * Wrap operator plain text as the single-section document the analysis path
 * expects (mirrors upsertFetchOutcome's plain-text fallback). CRLF is normalized
 * and surrounding blank lines trimmed; interior blank lines are kept — they
 * separate verses and the formatter relies on them.
 */
export function buildLyricsSections(text: string): LyricsDocument["sections"] {
	const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
	return [
		{
			type: "lyrics",
			lines: normalized.split("\n").map((line, index) => ({
				id: index + 1,
				text: line,
			})),
		},
	];
}

/**
 * SHA-256 of the document, prefixed with the schema version — same format the
 * worker's hashDocument produces. The value is never compared across systems (the
 * 'manual' slot is unique to this surface), but matching the format keeps a manual
 * row indistinguishable in shape from an automated one.
 */
async function hashDocument(document: LyricsDocument): Promise<string> {
	const data = new TextEncoder().encode(JSON.stringify(document));
	const buffer = await crypto.subtle.digest("SHA-256", data);
	const hex = Array.from(new Uint8Array(buffer))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
	return `ly_v${LYRICS_SCHEMA_VERSION}_${hex.slice(0, 16)}`;
}

export function validateLyricsText(input: unknown): string {
	if (typeof input !== "string" || input.trim().length === 0) {
		throw new HttpError(400, "Lyrics text is required.");
	}
	return input;
}

/**
 * Guard the manual-write endpoints with a clean 404 for an unknown song.
 * song_lyrics.song_id is an FK to song(id), so the upsert would otherwise fail
 * with a raw foreign-key violation (surfaced as a 500 with a leaked Postgres
 * message) instead of the intended "Song not found". The check is read-only and
 * cheap; the tiny window between it and the write is covered by the FK itself.
 */
async function ensureSongExists(songId: string): Promise<void> {
	const rows = await read<{ id: string }>(
		`select id from public.song where id = $1`,
		[songId],
	);
	if (rows.length === 0) {
		throw new HttpError(404, "Song not found.");
	}
}

export interface SaveLyricsResult {
	ok: true;
	songId: string;
}

/**
 * Write (or overwrite) the operator's lyrics under source='manual', fetch_status
 * 'lyrics'. The selector re-opens the song for reanalysis on its next run because
 * updated_at now exceeds the latest analysis — no wake needed.
 */
export async function saveManualLyrics(
	songId: string,
	textInput: unknown,
): Promise<SaveLyricsResult> {
	const text = validateLyricsText(textInput);
	const document: LyricsDocument = {
		schemaVersion: LYRICS_SCHEMA_VERSION,
		source: MANUAL_SOURCE,
		sections: buildLyricsSections(text),
	};
	const contentHash = await hashDocument(document);

	await ensureSongExists(songId);

	await tx(async (run) => {
		await run(
			`insert into public.song_lyrics
				(song_id, source, document, content_hash, has_annotations,
				 schema_version, fetch_status, fetch_source)
			 values ($1, $2, $3::jsonb, $4, false, $5, 'lyrics', null)
			 on conflict (song_id, source) do update set
				document = excluded.document,
				content_hash = excluded.content_hash,
				has_annotations = excluded.has_annotations,
				schema_version = excluded.schema_version,
				fetch_status = excluded.fetch_status,
				fetch_source = excluded.fetch_source`,
			[
				songId,
				MANUAL_SOURCE,
				JSON.stringify(document),
				contentHash,
				LYRICS_SCHEMA_VERSION,
			],
		);
	});
	return { ok: true, songId };
}

export interface MarkInstrumentalResult {
	ok: true;
	songId: string;
}

/**
 * Settle the song as instrumental under source='manual' (no document; sentinel
 * hash + schema version, matching the worker's instrumental rows). Latest
 * fetch_status='instrumental' keeps the selector from re-opening it.
 */
export async function markInstrumental(
	songId: string,
): Promise<MarkInstrumentalResult> {
	await ensureSongExists(songId);

	await tx(async (run) => {
		await run(
			`insert into public.song_lyrics
				(song_id, source, document, content_hash, has_annotations,
				 schema_version, fetch_status, fetch_source)
			 values ($1, $2, null, $3, false, $4, 'instrumental', null)
			 on conflict (song_id, source) do update set
				document = null,
				content_hash = excluded.content_hash,
				has_annotations = false,
				schema_version = excluded.schema_version,
				fetch_status = 'instrumental',
				fetch_source = null`,
			[songId, MANUAL_SOURCE, NO_CONTENT_HASH, NO_CONTENT_SCHEMA_VERSION],
		);
	});
	return { ok: true, songId };
}
