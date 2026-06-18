/**
 * Audio-feature review center — server actions for the control panel.
 *
 * Auto-backfilled audio features go live immediately; these are the operator's
 * safety net. List is a read-only join; approve/reject/replace mutate prod, so
 * they run inside the deliberate read-write transaction helper (db.tx) — never
 * the read-only `read`.
 *
 * Reject is the subtle one: an auto feature was live, so any song_analysis /
 * song_embedding generated at-or-after the review may have consumed bad audio.
 * Reject therefore deletes the exact feature row AND those downstream artifacts
 * (scoped to this song, created >= the review) in one transaction, then wakes
 * enrichment so the song re-analyzes with the replacement feature or lyrics-only
 * inputs. Without the wake the deletes would leave the song un-analyzed, because
 * enrichment is event-driven, not a periodic re-scan.
 *
 * The wake reuses the product helper (env-bootstrap points it at prod, exactly
 * like operations.ts) so it fires the identical songs_unlocked library-processing
 * side effect instead of a drifting SQL reimplementation. This is one of the
 * control panel's documented product-import exceptions — see control-panel/
 * README.md ("Architecture"). Everything else here is local SQL so the review
 * surface stays self-contained.
 */

import { wakeEnrichmentForSong } from "@/lib/domains/enrichment/audio-feature-backfill/wake";
import { read, tx } from "./db";

export interface AudioFeatureReviewRow {
	id: string;
	status: "pending" | "approved" | "rejected";
	sourceType: "youtube_search" | "youtube_url";
	createdAt: string;

	songId: string;
	songName: string;
	artists: string[];
	albumName: string | null;
	imageUrl: string | null;
	spotifyDurationMs: number | null;

	audioFeatureId: string | null;
	acousticness: number | null;
	danceability: number | null;
	energy: number | null;
	instrumentalness: number | null;
	liveness: number | null;
	loudness: number | null;
	speechiness: number | null;
	tempo: number | null;
	valence: number | null;

	youtubeUrl: string | null;
	youtubeVideoId: string | null;
	youtubeTitle: string | null;
	youtubeChannel: string | null;
	youtubeDurationSeconds: number | null;
	youtubeThumbnailUrl: string | null;

	searchQuery: string | null;
	matchScore: number | null;
	matchReasons: string[];
	clipStartsSeconds: number[];
	aggregationMetadata: Record<string, unknown>;
}

const numOrNull = (v: unknown): number | null =>
	v == null ? null : Number(v);

/**
 * Parse a one-dimensional Postgres array literal (e.g. `{Oasis}` or
 * `{"Some, Artist","Featured"}`) into a JS array. The control-panel db client
 * runs postgres.js with `fetch_types: false` (required by the Supabase pooler),
 * which leaves it with no OID catalog to recognise array columns — so `text[]`
 * and `numeric[]` arrive as raw literal STRINGS, not parsed arrays. Real arrays
 * (tests, any type-aware driver) pass straight through `asStringArray` above.
 */
function parsePgArrayLiteral(literal: string): string[] {
	const s = literal.trim();
	if (!s.startsWith("{") || !s.endsWith("}")) return [];
	const inner = s.slice(1, -1);
	if (inner.length === 0) return [];

	const out: string[] = [];
	let i = 0;
	while (i < inner.length) {
		if (inner[i] === '"') {
			i++;
			let val = "";
			while (i < inner.length) {
				const c = inner[i];
				if (c === "\\") {
					val += inner[i + 1] ?? "";
					i += 2;
					continue;
				}
				if (c === '"') {
					i++;
					break;
				}
				val += c;
				i++;
			}
			out.push(val);
			while (i < inner.length && inner[i] !== ",") i++;
			i++;
		} else {
			let j = i;
			while (j < inner.length && inner[j] !== ",") j++;
			const token = inner.slice(i, j).trim();
			// Unquoted NULL is the SQL null sentinel, not the literal text "NULL".
			if (token !== "NULL") out.push(token);
			i = j + 1;
		}
	}
	return out;
}

function asStringArray(v: unknown): string[] {
	if (Array.isArray(v)) return v.map((x) => String(x));
	if (typeof v === "string") return parsePgArrayLiteral(v);
	return [];
}

function asNumberArray(v: unknown): number[] {
	if (Array.isArray(v)) return v.map((x) => Number(x));
	if (typeof v === "string") return parsePgArrayLiteral(v).map(Number);
	return [];
}

function asRecord(v: unknown): Record<string, unknown> {
	return v && typeof v === "object" && !Array.isArray(v)
		? (v as Record<string, unknown>)
		: {};
}

export function mapRow(r: Record<string, unknown>): AudioFeatureReviewRow {
	return {
		id: String(r.id),
		status: r.status as AudioFeatureReviewRow["status"],
		sourceType: r.source_type as AudioFeatureReviewRow["sourceType"],
		createdAt: String(r.created_at),

		songId: String(r.song_id),
		songName: String(r.song_name ?? ""),
		artists: asStringArray(r.artists),
		albumName: r.album_name == null ? null : String(r.album_name),
		imageUrl: r.image_url == null ? null : String(r.image_url),
		spotifyDurationMs: numOrNull(r.duration_ms),

		audioFeatureId: r.audio_feature_id == null ? null : String(r.audio_feature_id),
		acousticness: numOrNull(r.acousticness),
		danceability: numOrNull(r.danceability),
		energy: numOrNull(r.energy),
		instrumentalness: numOrNull(r.instrumentalness),
		liveness: numOrNull(r.liveness),
		loudness: numOrNull(r.loudness),
		speechiness: numOrNull(r.speechiness),
		tempo: numOrNull(r.tempo),
		valence: numOrNull(r.valence),

		youtubeUrl: r.youtube_url == null ? null : String(r.youtube_url),
		youtubeVideoId: r.youtube_video_id == null ? null : String(r.youtube_video_id),
		youtubeTitle: r.youtube_title == null ? null : String(r.youtube_title),
		youtubeChannel: r.youtube_channel == null ? null : String(r.youtube_channel),
		youtubeDurationSeconds: numOrNull(r.youtube_duration_seconds),
		youtubeThumbnailUrl:
			r.youtube_thumbnail_url == null ? null : String(r.youtube_thumbnail_url),

		searchQuery: r.search_query == null ? null : String(r.search_query),
		matchScore: numOrNull(r.match_score),
		matchReasons: asStringArray(r.match_reasons),
		clipStartsSeconds: asNumberArray(r.clip_starts_seconds),
		aggregationMetadata: asRecord(r.aggregation_metadata),
	};
}

const REVIEW_SELECT = `
	select
		r.id, r.status, r.source_type, r.created_at,
		r.song_id, r.audio_feature_id,
		r.youtube_url, r.youtube_video_id, r.youtube_title, r.youtube_channel,
		r.youtube_duration_seconds, r.youtube_thumbnail_url,
		r.search_query, r.match_score, r.match_reasons, r.clip_starts_seconds,
		r.aggregation_metadata,
		s.name as song_name, s.artists, s.album_name, s.image_url, s.duration_ms,
		saf.acousticness, saf.danceability, saf.energy, saf.instrumentalness,
		saf.liveness, saf.loudness, saf.speechiness, saf.tempo, saf.valence
	from public.audio_feature_source_review r
	join public.song s on s.id = r.song_id
	left join public.song_audio_feature saf on saf.id = r.audio_feature_id
`;

export async function listAudioReviews(
	status: AudioFeatureReviewRow["status"] = "pending",
): Promise<AudioFeatureReviewRow[]> {
	const rows = await read(
		`${REVIEW_SELECT} where r.status = $1 order by r.created_at desc limit 200`,
		[status],
	);
	return rows.map(mapRow);
}

export interface ApproveResult {
	ok: true;
	id: string;
}

export async function approveAudioReview(
	id: string,
	reviewedBy: string,
): Promise<ApproveResult> {
	const updated = await tx(async (run) => {
		const rows = await run(
			`update public.audio_feature_source_review
			 set status = 'approved', reviewed_at = now(), reviewed_by = $2, updated_at = now()
			 where id = $1 and status = 'pending'
			 returning id`,
			[id, reviewedBy],
		);
		return rows;
	});
	if (updated.length === 0) {
		throw new Error("Review not found or no longer pending.");
	}
	return { ok: true, id };
}

export interface RejectResult {
	ok: true;
	songId: string;
	deletedFeatures: number;
	invalidatedAnalyses: number;
	invalidatedEmbeddings: number;
	wokeAccounts: number;
}

/**
 * Reject + delete, transactionally. Returns the song id and downstream-delete
 * counts so the caller can wake enrichment after commit.
 */
async function rejectInTransaction(
	id: string,
	reviewedBy: string,
	reason: string | null,
): Promise<Omit<RejectResult, "ok" | "wokeAccounts">> {
	return tx(async (run) => {
		const reviewRows = await run<{
			song_id: string;
			audio_feature_id: string | null;
			backfill_job_id: string | null;
			created_at: string;
		}>(
			`select song_id, audio_feature_id, backfill_job_id, created_at
			 from public.audio_feature_source_review
			 where id = $1 and status = 'pending'
			 for update`,
			[id],
		);
		const review = reviewRows[0];
		if (!review) {
			throw new Error("Review not found or no longer pending.");
		}
		if (!review.audio_feature_id) {
			throw new Error("Review has no linked feature to delete.");
		}

		const songId = review.song_id;
		const createdAt = review.created_at;

		// Delete the EXACT feature row this review created — by id and song, so a
		// feature replaced since insertion can't be deleted out from under us.
		const deleted = await run(
			`delete from public.song_audio_feature saf
			 using public.audio_feature_source_review r
			 where r.id = $1
			   and saf.id = r.audio_feature_id
			   and saf.song_id = r.song_id
			 returning saf.id`,
			[id],
		);
		if (deleted.length === 0) {
			// The feature was already replaced/deleted: don't silently mark rejected.
			throw new Error(
				"No feature row deleted — it may have already been replaced. Refresh and retry.",
			);
		}

		// Downstream invalidation, scoped to this song and to artifacts created
		// at/after the review (the window in which the now-deleted live feature
		// could have been consumed). Embeddings derive from the analysis text, so
		// both go. Time-scoped so older, unrelated analysis is untouched.
		const invalidatedEmbeddings = await run(
			`delete from public.song_embedding
			 where song_id = $1 and created_at >= $2
			 returning id`,
			[songId, createdAt],
		);
		const invalidatedAnalyses = await run(
			`delete from public.song_analysis
			 where song_id = $1 and created_at >= $2
			 returning id`,
			[songId, createdAt],
		);

		await run(
			`update public.audio_feature_source_review
			 set status = 'rejected', reviewed_at = now(), reviewed_by = $2,
			     rejection_reason = $3, updated_at = now()
			 where id = $1`,
			[id, reviewedBy, reason],
		);

		// Mark the source job terminal so audio_feature_state() reports the song as
		// manual_needed, NOT 'absent'. Without this, deleting the feature leaves no
		// active/terminal job, the song reads 'absent', and the selector re-enqueues
		// an automatic YouTube search — re-inserting the same bad feature the
		// operator just rejected. manual_needed suppresses auto-retry while still
		// letting analysis proceed (lyrics-only). Skip active jobs: a pending/running
		// replacement already makes the song backfill_active and must win.
		if (review.backfill_job_id) {
			await run(
				`update public.audio_feature_backfill_job
				 set status = 'manual_needed', error_code = 'operator_rejected',
				     error_message = 'operator rejected the auto-backfilled feature',
				     completed_at = now(), lease_expires_at = null, updated_at = now()
				 where id = $1 and status not in ('pending', 'running')`,
				[review.backfill_job_id],
			);
		}

		return {
			songId,
			deletedFeatures: deleted.length,
			invalidatedAnalyses: invalidatedAnalyses.length,
			invalidatedEmbeddings: invalidatedEmbeddings.length,
		};
	});
}

export async function rejectAudioReview(
	id: string,
	reviewedBy: string,
	reason: string | null,
): Promise<RejectResult> {
	const result = await rejectInTransaction(id, reviewedBy, reason);
	// Wake AFTER commit: the feature and stale downstream are gone, so the
	// re-triggered enrichment sees the song needing analysis again.
	const woke = await wakeEnrichmentForSong(result.songId);
	return { ok: true, ...result, wokeAccounts: woke.length };
}

const ALLOWED_YOUTUBE_HOSTS = new Set([
	"youtube.com",
	"www.youtube.com",
	"music.youtube.com",
	"youtu.be",
]);

/**
 * Validate a YouTube URL by host allow-list and return the canonical watch URL
 * + video id. Inlined (not imported from the product) to keep the review server
 * self-contained, mirroring the worker's url.ts host policy.
 */
export function parseYoutubeUrl(
	input: string,
): { canonicalUrl: string; videoId: string } | null {
	let url: URL;
	try {
		url = new URL(input.trim());
	} catch {
		return null;
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") return null;
	const host = url.hostname.toLowerCase();
	if (!ALLOWED_YOUTUBE_HOSTS.has(host)) return null;

	let videoId: string | null = null;
	if (host === "youtu.be") {
		videoId = url.pathname.slice(1).split("/")[0] || null;
	} else if (url.pathname === "/watch") {
		videoId = url.searchParams.get("v");
	} else if (url.pathname.startsWith("/shorts/")) {
		videoId = url.pathname.split("/")[2] ?? null;
	}
	if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;

	return {
		canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
		videoId,
	};
}

export interface ReplaceResult {
	ok: true;
	songId: string;
	manualJobId: string;
	canonicalUrl: string;
	deletedFeatures: number;
	invalidatedAnalyses: number;
	invalidatedEmbeddings: number;
	wokeAccounts: number;
}

/**
 * Replace with an operator-supplied YouTube URL: reject the current review (which
 * deletes the bad feature + stale downstream) and, in the SAME transaction,
 * enqueue a manual youtube_url backfill job. enqueue_audio_feature_backfill_manual
 * obsoletes any active auto job first, so a late automatic worker can't overwrite
 * the operator's pick. Wake after commit so the manual job is processed promptly.
 */
export async function replaceAudioReviewWithYoutube(
	id: string,
	rawUrl: string,
	reviewedBy: string,
): Promise<ReplaceResult> {
	const parsed = parseYoutubeUrl(rawUrl);
	if (!parsed) {
		throw new Error(
			"Invalid YouTube URL. Allowed hosts: youtube.com, music.youtube.com, youtu.be.",
		);
	}

	const result = await tx(async (run) => {
		const reviewRows = await run<{
			song_id: string;
			audio_feature_id: string | null;
			created_at: string;
		}>(
			`select song_id, audio_feature_id, created_at
			 from public.audio_feature_source_review
			 where id = $1 and status = 'pending'
			 for update`,
			[id],
		);
		const review = reviewRows[0];
		if (!review) {
			throw new Error("Review not found or no longer pending.");
		}
		const songId = review.song_id;
		const createdAt = review.created_at;

		const deleted = review.audio_feature_id
			? await run(
					`delete from public.song_audio_feature saf
					 using public.audio_feature_source_review r
					 where r.id = $1 and saf.id = r.audio_feature_id and saf.song_id = r.song_id
					 returning saf.id`,
					[id],
				)
			: [];

		const invalidatedEmbeddings = await run(
			`delete from public.song_embedding where song_id = $1 and created_at >= $2 returning id`,
			[songId, createdAt],
		);
		const invalidatedAnalyses = await run(
			`delete from public.song_analysis where song_id = $1 and created_at >= $2 returning id`,
			[songId, createdAt],
		);

		await run(
			`update public.audio_feature_source_review
			 set status = 'rejected', reviewed_at = now(), reviewed_by = $2,
			     rejection_reason = $3, updated_at = now()
			 where id = $1`,
			[id, reviewedBy, "replaced with operator YouTube URL"],
		);

		const jobRows = await run<{ id: string }>(
			`select id from public.enqueue_audio_feature_backfill_manual($1, $2, NULL)`,
			[songId, parsed.canonicalUrl],
		);
		const manualJobId = jobRows[0]?.id;
		if (!manualJobId) {
			throw new Error("Failed to enqueue manual replacement job.");
		}

		return {
			songId,
			manualJobId,
			deletedFeatures: deleted.length,
			invalidatedAnalyses: invalidatedAnalyses.length,
			invalidatedEmbeddings: invalidatedEmbeddings.length,
		};
	});

	const woke = await wakeEnrichmentForSong(result.songId);
	return {
		ok: true,
		canonicalUrl: parsed.canonicalUrl,
		wokeAccounts: woke.length,
		...result,
	};
}
