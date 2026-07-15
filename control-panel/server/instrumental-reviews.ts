/**
 * Instrumental-classification review center — server actions for the control panel.
 *
 * Content analysis auto-classifies a lyric-less song as instrumental from its
 * genre / Spotify instrumentalness — a heuristic that occasionally mislabels a
 * vocal track. Each determination goes live immediately (the song is settled
 * instrumental) and is logged as 'pending' here, exactly like auto-backfilled
 * audio features. This surface is the operator's safety net: approve the correct
 * ones, reject the wrong ones.
 *
 * List is read-only; approve/reject mutate prod, so they run through the
 * deliberate read-write transaction helper (db.tx). Reject is the involved one:
 * the live instrumental verdict produced a song_analysis (and an embedding from
 * it), so reject deletes the 'analysis' lyrics settle row AND those downstream
 * artifacts, then marks the review 'rejected'. That rejected row is the operator's
 * standing veto — the analyzer reads it and won't re-classify the song
 * instrumental, so it can't bounce back. The song reverts to 'not_found' and
 * reappears in the lyrics-review queue for manual entry. No enrichment wake is
 * needed: the selector re-opens the song on its next pass.
 *
 * Reject only deletes when the song is STILL settled instrumental by this
 * auto-verdict (its latest song_lyrics row is the 'analysis' settle). If a later
 * manual-lyrics entry or an automated lyrics discovery already superseded it, the
 * current analysis/embedding describe that new (lyrical) state — deleting them
 * would be data loss, so reject only records the rejection. The pending list and
 * count apply the same liveness predicate so a superseded card never surfaces.
 *
 * Self-contained local SQL, like the other review surfaces — no product imports.
 */

import { read, tx } from "./db";
import {
	type PageResult,
	type PageSize,
	parseQueueQuery,
	type QueueOrder,
} from "./query-params";

export interface InstrumentalReviewRow {
	id: string;
	status: "pending" | "approved" | "rejected";
	signal: "instrumentalness" | "genre";
	instrumentalness: number | null;
	matchedGenre: string | null;
	createdAt: string;

	songId: string;
	songName: string;
	artistLabel: string;
	albumName: string | null;
	imageUrl: string | null;
	durationMs: number | null;
}

const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));

export function mapRow(r: Record<string, unknown>): InstrumentalReviewRow {
	return {
		id: String(r.id),
		status: r.status as InstrumentalReviewRow["status"],
		signal: r.signal as InstrumentalReviewRow["signal"],
		instrumentalness: numOrNull(r.instrumentalness),
		matchedGenre: r.matched_genre == null ? null : String(r.matched_genre),
		createdAt: String(r.created_at),

		songId: String(r.song_id),
		songName: String(r.song_name ?? ""),
		// array_to_string'd in SQL, so we never parse the raw text[] literal the
		// type-less pooler driver would otherwise return.
		artistLabel: r.artist_label == null ? "" : String(r.artist_label),
		albumName: r.album_name == null ? null : String(r.album_name),
		imageUrl: r.image_url == null ? null : String(r.image_url),
		durationMs: numOrNull(r.duration_ms),
	};
}

// The lateral picks each review's single most-recent song_lyrics row; the pending
// queue keys on it to drop superseded cards (see livenessFilter below).
const REVIEW_SELECT = `
	select
		r.id, r.status, r.signal, r.instrumentalness, r.matched_genre, r.created_at,
		r.song_id, s.name as song_name,
		array_to_string(s.artists, ', ') as artist_label,
		s.album_name, s.image_url, s.duration_ms
	from public.song_instrumental_review r
	join public.song s on s.id = r.song_id
	left join lateral (
		select sl.source, sl.fetch_status
		from public.song_lyrics sl
		where sl.song_id = r.song_id
		order by sl.updated_at desc
		limit 1
	) latest on true
`;

// A pending review is only actionable while the song is STILL settled instrumental
// by its auto-verdict — i.e. the latest song_lyrics row is the 'analysis' settle.
// Once a manual-lyrics entry or an automated lyrics discovery writes a newer row,
// the card is stale and rejecting it would delete the song's new, correct lyrical
// analysis, so it must not appear. Audit lookups (approved/rejected) skip this.
const PENDING_LIVENESS =
	"and latest.source = 'analysis' and latest.fetch_status = 'instrumental'";

function escapeLike(value: string): string {
	return value.replace(/([\\%_])/g, "\\$1");
}

export type InstrumentalSignal = "instrumentalness" | "genre" | "all";

export interface InstrumentalListParams {
	status: InstrumentalReviewRow["status"];
	q: string;
	order: QueueOrder;
	page: number;
	pageSize: PageSize;
	signal: InstrumentalSignal;
	// Only rows whose instrumentalness is at least this (0–1), for tuning the
	// threshold. Ignored for genre-signal rows, which have no instrumentalness.
	minInstrumentalness: number | null;
}

function parseStatus(value: string | null): InstrumentalReviewRow["status"] {
	return value === "approved" || value === "rejected" ? value : "pending";
}

function parseUnitInterval(value: string | null): number | null {
	if (value === null || value.trim() === "") return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : null;
}

export function parseInstrumentalQuery(url: URL): InstrumentalListParams {
	const base = parseQueueQuery(url, "newest");
	const signal = url.searchParams.get("signal");
	return {
		status: parseStatus(url.searchParams.get("status")),
		q: base.q,
		order: base.order,
		page: base.page,
		pageSize: base.pageSize,
		signal:
			signal === "instrumentalness" || signal === "genre" ? signal : "all",
		minInstrumentalness: parseUnitInterval(
			url.searchParams.get("minInstrumentalness"),
		),
	};
}

export async function instrumentalReviewsPage(
	url: URL,
): Promise<PageResult<InstrumentalReviewRow>> {
	const query = parseInstrumentalQuery(url);
	const params: unknown[] = [query.status];
	// Only the pending queue enforces liveness; audit tabs (approved/rejected)
	// show the full history even where the song has since moved on.
	const where: string[] = ["r.status = $1"];
	if (query.status === "pending") where.push(PENDING_LIVENESS.replace(/^and /, ""));
	if (query.q) {
		params.push(`%${escapeLike(query.q)}%`);
		where.push(
			`(s.name ilike $${params.length} or array_to_string(s.artists, ', ') ilike $${params.length})`,
		);
	}
	if (query.signal !== "all") {
		params.push(query.signal);
		where.push(`r.signal = $${params.length}`);
	}
	if (query.minInstrumentalness != null) {
		params.push(query.minInstrumentalness);
		where.push(`r.instrumentalness >= $${params.length}`);
	}
	const predicate = where.join(" and ");
	const direction = query.order === "oldest" ? "asc" : "desc";
	const countRows = await read<{ total: string }>(
		`select count(*) as total
		 from public.song_instrumental_review r
		 join public.song s on s.id = r.song_id
		 left join lateral (
			select sl.source, sl.fetch_status
			from public.song_lyrics sl
			where sl.song_id = r.song_id
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
		`${REVIEW_SELECT} where ${predicate}
		 order by r.created_at ${direction}, r.id asc
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

/** Counts live pending reviews so the nav/section badges only actionable cards. */
export async function countPendingInstrumentalReviews(): Promise<number> {
	const rows = await read<{ pending: string }>(
		`select count(*)::text as pending
		 from public.song_instrumental_review r
		 left join lateral (
			select sl.source, sl.fetch_status
			from public.song_lyrics sl
			where sl.song_id = r.song_id
			order by sl.updated_at desc
			limit 1
		 ) latest on true
		 where r.status = 'pending' ${PENDING_LIVENESS}`,
	);
	return Number(rows[0]?.pending ?? 0);
}

export interface ApproveResult {
	ok: true;
	id: string;
}

export async function approveInstrumentalReview(
	id: string,
	reviewedBy: string,
): Promise<ApproveResult> {
	const updated = await tx(async (run) => {
		return run(
			`update public.song_instrumental_review
			 set status = 'approved', reviewed_at = now(), reviewed_by = $2, updated_at = now()
			 where id = $1 and status = 'pending'
			 returning id`,
			[id, reviewedBy],
		);
	});
	if (updated.length === 0) {
		throw new Error("Review not found or no longer pending.");
	}
	return { ok: true, id };
}

export interface RejectResult {
	ok: true;
	songId: string;
	// True when the song had already moved off the auto-instrumental verdict
	// (manual lyrics / automated discovery), so the rejection was recorded but
	// nothing was deleted — the data-loss guard fired.
	superseded: boolean;
	deletedSettleRows: number;
	deletedAnalyses: number;
	deletedEmbeddings: number;
}

/**
 * Reject ("this song has vocals"): undo the wrong instrumental verdict in one
 * transaction. Deletes the 'analysis' settle row (so the song reverts to
 * not_found / unfetched and returns to the lyrics-review queue), deletes the
 * instrumental analysis and the embedding derived from it, then marks the review
 * 'rejected' — which stands as the analyzer's veto so the song can't be
 * auto-re-classified instrumental before its real lyrics are entered.
 *
 * Guarded against a stale card: a pending review can outlive its verdict if a
 * manual-lyrics entry or an automated lyrics discovery already turned the song
 * lyrical (producing a NEW, correct analysis + embedding). In that case the
 * deletes would wipe the corrected artifacts, so we detect it (the latest
 * song_lyrics row is no longer the 'analysis' settle), skip every delete, and only
 * record the rejection. The PENDING_LIVENESS filter normally hides such cards, but
 * a request can still race a concurrent override — this is the authoritative stop.
 */
export async function rejectInstrumentalReview(
	id: string,
	reviewedBy: string,
	reason: string | null,
): Promise<RejectResult> {
	return tx(async (run) => {
		const reviewRows = await run<{ song_id: string }>(
			`select song_id from public.song_instrumental_review
			 where id = $1 and status = 'pending'
			 for update`,
			[id],
		);
		const review = reviewRows[0];
		if (!review) {
			throw new Error("Review not found or no longer pending.");
		}
		const songId = review.song_id;

		const latestRows = await run<{ source: string; fetch_status: string }>(
			`select source, fetch_status from public.song_lyrics
			 where song_id = $1
			 order by updated_at desc
			 limit 1`,
			[songId],
		);
		const latest = latestRows[0];
		const stillAutoInstrumental =
			latest?.source === "analysis" && latest?.fetch_status === "instrumental";

		let deletedSettleRows = 0;
		let deletedAnalyses = 0;
		let deletedEmbeddings = 0;

		if (stillAutoInstrumental) {
			// Drop the instrumental settle row so the song's latest fetch reverts to
			// not_found (or, if it had no other row, to unfetched — re-confirmed
			// not_found on the next enrichment pass). Either way it leaves the
			// instrumental state.
			const deletedSettle = await run(
				`delete from public.song_lyrics
				 where song_id = $1 and source = 'analysis'
				 returning id`,
				[songId],
			);
			// The instrumental verdict produced these; both are wrong for a vocal track.
			const deletedEmb = await run(
				`delete from public.song_embedding where song_id = $1 returning id`,
				[songId],
			);
			const deletedAna = await run(
				`delete from public.song_analysis where song_id = $1 returning id`,
				[songId],
			);
			deletedSettleRows = deletedSettle.length;
			deletedEmbeddings = deletedEmb.length;
			deletedAnalyses = deletedAna.length;
		}

		await run(
			`update public.song_instrumental_review
			 set status = 'rejected', reviewed_at = now(), reviewed_by = $2,
			     rejection_reason = $3, updated_at = now()
			 where id = $1`,
			[id, reviewedBy, reason],
		);

		return {
			ok: true,
			songId,
			superseded: !stillAutoInstrumental,
			deletedSettleRows,
			deletedAnalyses,
			deletedEmbeddings,
		};
	});
}
