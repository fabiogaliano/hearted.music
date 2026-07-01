/**
 * Audio-feature backfill job queue — server actions for the control panel.
 *
 * The companion to audio-feature-reviews.ts. That file handles songs that already
 * GOT an auto feature and await sign-off (audio_feature_source_review.status =
 * 'pending'). This file handles songs that got NO usable feature and are stuck
 * waiting on the operator:
 *
 *   - Needs URL   → audio_feature_state() = 'manual_needed'. The auto YouTube
 *                   search found no candidate confident enough (or none at all),
 *                   so auto-retry is suppressed and the song sits until an operator
 *                   supplies the right video URL.
 *   - Failed      → audio_feature_state() = 'unavailable_terminal'. The job
 *                   exhausted its retries / hit a hard error. A manual URL fixes it
 *                   the same way, so it shares this queue's single action.
 *
 * Both are read off the shared audio_feature_state() definition — the same one the
 * selector, audio stage, and worker read — so what the operator sees is exactly
 * what the pipeline considers stuck, not a raw status count that would over-report
 * songs which have since recovered (got a feature, or a newer active job).
 *
 * The submit-URL action reuses the product's enqueue_audio_feature_backfill_manual
 * RPC (obsoletes any active job first, so a late auto worker can't overwrite the
 * pick) and the product's enrichment wake helper — identical to the replace path
 * in audio-feature-reviews.ts, so a manual pick is processed promptly. parseYoutube
 * Url is shared from that module rather than re-inlined.
 */

import { wakeEnrichmentForSong } from "@/lib/domains/enrichment/audio-feature-backfill/wake";
import { type AudioFeatureCandidate, asCandidates } from "./audio-candidates";
import { parseYoutubeUrl } from "./audio-feature-reviews";
import { read, tx } from "./db";
import { HttpError } from "./http-error";

export type JobFilter = "needs_url" | "failed";

// The tab the operator picked maps to the shared availability state the pipeline
// computes. 'failed' surfaces as 'unavailable_terminal' in audio_feature_state().
const FILTER_STATE: Record<JobFilter, string> = {
	needs_url: "manual_needed",
	failed: "unavailable_terminal",
};

export interface AudioFeatureJobRow {
	jobId: string;
	songId: string;
	status: "manual_needed" | "failed";
	errorCode: string | null;
	errorMessage: string | null;
	attempts: number;
	sourceUrl: string | null;
	createdAt: string;
	updatedAt: string;

	songName: string;
	artistLabel: string;
	albumName: string | null;
	imageUrl: string | null;
	spotifyDurationMs: number | null;

	// What the auto-search actually found before it gave up: the full scored set
	// (empty for jobs that predate this capture, or manual-URL / failed jobs that
	// never ran a search). Lets the operator see the 0.63 link, not just the number.
	candidates: AudioFeatureCandidate[];
}

const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));

export function mapJobRow(r: Record<string, unknown>): AudioFeatureJobRow {
	return {
		jobId: String(r.job_id),
		songId: String(r.song_id),
		status: r.status as AudioFeatureJobRow["status"],
		errorCode: r.error_code == null ? null : String(r.error_code),
		errorMessage: r.error_message == null ? null : String(r.error_message),
		attempts: Number(r.attempts ?? 0),
		sourceUrl: r.source_url == null ? null : String(r.source_url),
		createdAt: String(r.created_at),
		updatedAt: String(r.updated_at),

		songName: String(r.song_name ?? ""),
		// array_to_string'd in SQL, so the type-less pooler driver (fetch_types:
		// false) never hands us a raw text[] literal to parse — see audio-feature-
		// reviews.ts for the array-literal problem this sidesteps.
		artistLabel: r.artist_label == null ? "" : String(r.artist_label),
		albumName: r.album_name == null ? null : String(r.album_name),
		imageUrl: r.image_url == null ? null : String(r.image_url),
		spotifyDurationMs: numOrNull(r.duration_ms),

		candidates: asCandidates(r.candidates),
	};
}

// One row per song: the latest terminal (manual_needed/failed) job, which is the
// one audio_feature_state() keys on. The state filter then keeps only songs still
// stuck in the requested state now — dropping any that got a feature or a fresh
// active job since (those read 'ready'/'backfill_active' and aren't the operator's
// problem). Oldest-updated first drains the longest-stuck end of the backlog.
const QUEUE_SELECT = `
	select
		j.id as job_id, j.song_id, j.status, j.error_code, j.error_message,
		j.attempts, j.source_url, j.candidates, j.created_at, j.updated_at,
		s.name as song_name,
		array_to_string(s.artists, ', ') as artist_label,
		s.album_name, s.image_url, s.duration_ms
	from public.audio_feature_backfill_job j
	join public.song s on s.id = j.song_id
	where j.status in ('manual_needed', 'failed')
		and public.audio_feature_state(j.song_id) = $1
		and j.id = (
			select j2.id from public.audio_feature_backfill_job j2
			where j2.song_id = j.song_id
				and j2.status in ('manual_needed', 'failed')
			order by j2.created_at desc
			limit 1
		)
	order by j.updated_at asc
	limit 200
`;

export async function listAudioFeatureJobs(
	filter: JobFilter = "needs_url",
): Promise<AudioFeatureJobRow[]> {
	const rows = await read(QUEUE_SELECT, [FILTER_STATE[filter]]);
	return rows.map(mapJobRow);
}

export interface QueueBuckets {
	approval: number;
	needsUrl: number;
	failed: number;
}

/**
 * All three tab totals in one round-trip so the labels stay accurate no matter
 * which tab is active (the list endpoints only return the active tab's rows).
 * approval is a plain pending-review count; needsUrl/failed run every distinct
 * candidate song through audio_feature_state() so they match the live-stuck
 * definition, not a raw job-status count.
 */
export async function countAudioQueueBuckets(): Promise<QueueBuckets> {
	const rows = await read<{
		approval: number;
		needs_url: number;
		failed: number;
	}>(
		`select
			(select count(*) from public.audio_feature_source_review where status = 'pending')::int as approval,
			x.needs_url,
			x.failed
		 from (
			select
				count(*) filter (where st = 'manual_needed')::int as needs_url,
				count(*) filter (where st = 'unavailable_terminal')::int as failed
			from (
				select public.audio_feature_state(song_id) as st
				from (
					select distinct song_id
					from public.audio_feature_backfill_job
					where status in ('manual_needed', 'failed')
				) c
			) y
		 ) x`,
	);
	const row = rows[0];
	return {
		approval: Number(row?.approval ?? 0),
		needsUrl: Number(row?.needs_url ?? 0),
		failed: Number(row?.failed ?? 0),
	};
}

/**
 * Guard the enqueue with a clean 404 for an unknown song. song_id is an FK on
 * audio_feature_backfill_job, so a bad id would otherwise surface as a raw
 * foreign-key 500 instead of the intended "Song not found".
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

export interface SubmitUrlResult {
	ok: true;
	songId: string;
	jobId: string;
	canonicalUrl: string;
	wokeAccounts: number;
}

/**
 * Operator supplies the YouTube URL for a stuck song. enqueue_audio_feature_
 * backfill_manual obsoletes any active job first (so a late auto worker can't win),
 * then inserts a youtube_url job. Wake after commit so the manual job is picked up
 * promptly. No feature/review to delete here — unlike the replace path, these songs
 * never had a usable feature. The RPC's requested_by account arg is NULL: the
 * control-panel operator isn't an account, and the table has no operator-label
 * column to record one.
 */
export async function submitManualUrl(
	songId: string,
	rawUrl: string,
): Promise<SubmitUrlResult> {
	const parsed = parseYoutubeUrl(rawUrl);
	if (!parsed) {
		throw new HttpError(
			400,
			"Invalid YouTube URL. Allowed hosts: youtube.com, music.youtube.com, youtu.be.",
		);
	}

	await ensureSongExists(songId);

	const jobId = await tx(async (run) => {
		const rows = await run<{ id: string }>(
			`select id from public.enqueue_audio_feature_backfill_manual($1, $2, NULL)`,
			[songId, parsed.canonicalUrl],
		);
		const id = rows[0]?.id;
		if (!id) {
			throw new Error("Failed to enqueue manual backfill job.");
		}
		return id;
	});

	const woke = await wakeEnrichmentForSong(songId);
	return {
		ok: true,
		songId,
		jobId,
		canonicalUrl: parsed.canonicalUrl,
		wokeAccounts: woke.length,
	};
}
