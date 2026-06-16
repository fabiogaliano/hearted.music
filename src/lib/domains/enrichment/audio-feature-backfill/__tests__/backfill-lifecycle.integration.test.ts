/**
 * Audio-feature backfill lifecycle — exercises migration
 * 20260615130000_audio_feature_backfill and the audio-state-driven selector
 * (20260615150000) against the real Postgres functions. These are the pieces
 * that can't be unit-tested with mocks: the SQL state machine
 * (audio_feature_state), the batch availability RPC, the fenced settlement RPCs,
 * the one-active-job-per-song guard, the manual-replacement cancel, the stale
 * lease sweep, and how the work-plan selector reads all of that.
 *
 * Runs against the local Supabase Postgres only — auto-skipped when SUPABASE_URL
 * is not the local URL so CI without a local stack is unaffected.
 */

import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/lib/data/database.types";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const IS_LOCAL =
	SUPABASE_URL.startsWith("http://127.0.0.1") &&
	SUPABASE_SERVICE_ROLE_KEY.length > 0;

const supabase = IS_LOCAL
	? createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
			auth: { autoRefreshToken: false, persistSession: false },
		})
	: null;

interface Fixture {
	accountId: string;
	songId: string;
}

function db() {
	if (!supabase) throw new Error("supabase client not initialised");
	return supabase;
}

/** Create an entitled liked song with no audio feature and no backfill job. */
async function makeFixture(): Promise<Fixture> {
	const accountId = crypto.randomUUID();
	const songId = crypto.randomUUID();

	await db()
		.from("account")
		.insert({ id: accountId, spotify_id: `test-${accountId}` })
		.throwOnError();

	await db()
		.from("account_billing")
		.insert({
			account_id: accountId,
			plan: "free",
			unlimited_access_source: null,
			subscription_status: "none",
		})
		.throwOnError();

	await db()
		.from("song")
		.insert({
			id: songId,
			spotify_id: `sp-${songId}`,
			name: "Test Song",
			artists: ["Artist"],
			artist_ids: ["art-1"],
			// Empty genres → needs_genre_tagging stays true, which keeps the song
			// in the selector's output even when audio/analysis are suppressed, so
			// the audio/analysis flags can be asserted directly (the selector drops
			// any song whose needs-flags are all false).
			genres: [],
		})
		.throwOnError();

	await db()
		.from("liked_song")
		.insert({
			account_id: accountId,
			song_id: songId,
			liked_at: new Date().toISOString(),
		})
		.throwOnError();

	// Entitlement: an active (non-revoked) unlock makes the song selectable.
	await db()
		.from("account_song_unlock")
		.insert({ account_id: accountId, song_id: songId, source: "free_auto" })
		.throwOnError();

	return { accountId, songId };
}

async function teardownFixture(f: Fixture) {
	if (!supabase) return;
	// song cascade clears audio_feature_backfill_job + song_audio_feature;
	// account cascade clears liked_song + unlock + billing.
	await db().from("song").delete().eq("id", f.songId).throwOnError();
	await db().from("account").delete().eq("id", f.accountId).throwOnError();
}

async function stateOf(songId: string): Promise<string> {
	const { data, error } = await db().rpc("audio_feature_state", {
		p_song_id: songId,
	});
	if (error) throw error;
	return data as unknown as string;
}

async function availabilityOf(songId: string) {
	const { data, error } = await db().rpc("get_audio_feature_availability", {
		p_song_ids: [songId],
	});
	if (error) throw error;
	const row = (data ?? []).find((r) => r.song_id === songId);
	if (!row) throw new Error("availability row missing");
	return row;
}

async function selectorRow(accountId: string, songId: string) {
	const { data, error } = await db().rpc(
		"select_liked_song_ids_needing_enrichment_work",
		{ p_account_id: accountId, p_limit: 50 },
	);
	if (error) throw error;
	return (data ?? []).find((r) => r.song_id === songId);
}

async function insertFeatureRow(songId: string) {
	await db()
		.from("song_audio_feature")
		.insert({ song_id: songId, energy: 0.5, valence: 0.5, tempo: 120 })
		.throwOnError();
}

let fixture: Fixture | null = null;

beforeEach(async () => {
	if (!IS_LOCAL) return;
	fixture = await makeFixture();
});

afterEach(async () => {
	if (!IS_LOCAL || !fixture) return;
	await teardownFixture(fixture);
	fixture = null;
});

describe.skipIf(!IS_LOCAL)("audio_feature_state transitions", () => {
	it("a fresh entitled song with no feature and no job is absent", async () => {
		if (!fixture) throw new Error("missing");
		expect(await stateOf(fixture.songId)).toBe("absent");
	});

	it("a pending backfill job moves the song to backfill_active", async () => {
		if (!fixture) throw new Error("missing");
		await db().rpc("enqueue_audio_feature_backfill_search", {
			p_song_id: fixture.songId,
			p_requested_by_account_id: fixture.accountId,
		});
		expect(await stateOf(fixture.songId)).toBe("backfill_active");
	});

	it("a feature row wins over an active job (ready beats backfill_active)", async () => {
		if (!fixture) throw new Error("missing");
		await db().rpc("enqueue_audio_feature_backfill_search", {
			p_song_id: fixture.songId,
			p_requested_by_account_id: fixture.accountId,
		});
		await insertFeatureRow(fixture.songId);
		expect(await stateOf(fixture.songId)).toBe("ready");
	});

	it("a manual_needed job is reported as manual_needed", async () => {
		if (!fixture) throw new Error("missing");
		await db()
			.from("audio_feature_backfill_job")
			.insert({
				song_id: fixture.songId,
				source_type: "youtube_search",
				status: "manual_needed",
				error_code: "low_confidence",
			})
			.throwOnError();
		expect(await stateOf(fixture.songId)).toBe("manual_needed");

		const availability = await availabilityOf(fixture.songId);
		expect(availability.state).toBe("manual_needed");
		expect(availability.error_code).toBe("low_confidence");
		expect(availability.job_id).not.toBeNull();
	});

	it("a failed job is reported as unavailable_terminal", async () => {
		if (!fixture) throw new Error("missing");
		await db()
			.from("audio_feature_backfill_job")
			.insert({
				song_id: fixture.songId,
				source_type: "youtube_search",
				status: "failed",
				error_code: "download_failed",
			})
			.throwOnError();
		expect(await stateOf(fixture.songId)).toBe("unavailable_terminal");
	});
});

describe.skipIf(!IS_LOCAL)("selector reads audio availability state", () => {
	it("absent song needs audio_features and analysis", async () => {
		if (!fixture) throw new Error("missing");
		const row = await selectorRow(fixture.accountId, fixture.songId);
		expect(row?.needs_audio_features).toBe(true);
		expect(row?.needs_analysis).toBe(true);
	});

	it("backfill_active suppresses BOTH audio_features and analysis (the SQL gate)", async () => {
		if (!fixture) throw new Error("missing");
		await db().rpc("enqueue_audio_feature_backfill_search", {
			p_song_id: fixture.songId,
			p_requested_by_account_id: fixture.accountId,
		});

		const row = await selectorRow(fixture.accountId, fixture.songId);
		// The song is still selectable for OTHER work but not these two stages.
		expect(row?.needs_audio_features).toBe(false);
		expect(row?.needs_analysis).toBe(false);
	});

	it("a landed feature stops audio_features but resumes analysis", async () => {
		if (!fixture) throw new Error("missing");
		// Simulate the backfill worker completing: job done + feature row present.
		await db().rpc("enqueue_audio_feature_backfill_search", {
			p_song_id: fixture.songId,
			p_requested_by_account_id: fixture.accountId,
		});
		await insertFeatureRow(fixture.songId);
		await db()
			.from("audio_feature_backfill_job")
			.update({ status: "completed", completed_at: new Date().toISOString() })
			.eq("song_id", fixture.songId)
			.throwOnError();

		const row = await selectorRow(fixture.accountId, fixture.songId);
		expect(row?.needs_audio_features).toBe(false);
		expect(row?.needs_analysis).toBe(true);
	});

	it("manual_needed stops audio_features but lets analysis proceed", async () => {
		if (!fixture) throw new Error("missing");
		await db()
			.from("audio_feature_backfill_job")
			.insert({
				song_id: fixture.songId,
				source_type: "youtube_search",
				status: "manual_needed",
				error_code: "low_confidence",
			})
			.throwOnError();

		const row = await selectorRow(fixture.accountId, fixture.songId);
		expect(row?.needs_audio_features).toBe(false);
		// Terminal backfill state: analysis no longer waits for audio.
		expect(row?.needs_analysis).toBe(true);
	});

	it("a transient audio_features suppression still backs off catalog lookup", async () => {
		if (!fixture) throw new Error("missing");
		// A PROVIDER_TRANSIENT failure (NOT a catalog miss) writes a suppression
		// row; the state stays 'absent' but the selector must honor the backoff.
		const { data: job } = await db()
			.from("job")
			.insert({ account_id: fixture.accountId, type: "enrichment" })
			.select("id")
			.single()
			.throwOnError();
		if (!job) throw new Error("job insert failed");

		await db()
			.from("job_item_failure")
			.insert({
				job_id: job.id,
				item_type: "song",
				item_id: fixture.songId,
				stage: "audio_features",
				failure_code: "provider_transient",
				is_terminal: false,
				suppress_until: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
			})
			.throwOnError();

		expect(await stateOf(fixture.songId)).toBe("absent");
		const row = await selectorRow(fixture.accountId, fixture.songId);
		expect(row?.needs_audio_features).toBe(false);
	});
});

describe.skipIf(!IS_LOCAL)("enqueue and manual replacement", () => {
	it("enqueue_search is idempotent: two calls yield one active job", async () => {
		if (!fixture) throw new Error("missing");
		const first = await db().rpc("enqueue_audio_feature_backfill_search", {
			p_song_id: fixture.songId,
			p_requested_by_account_id: fixture.accountId,
		});
		const second = await db().rpc("enqueue_audio_feature_backfill_search", {
			p_song_id: fixture.songId,
			p_requested_by_account_id: fixture.accountId,
		});

		expect(first.error).toBeNull();
		expect(second.error).toBeNull();
		expect(second.data?.id).toBe(first.data?.id);

		const { count } = await db()
			.from("audio_feature_backfill_job")
			.select("id", { count: "exact", head: true })
			.eq("song_id", fixture.songId)
			.in("status", ["pending", "running"]);
		expect(count).toBe(1);
	});

	it("manual replacement obsoletes the active search and becomes the live job", async () => {
		if (!fixture) throw new Error("missing");
		const auto = await db().rpc("enqueue_audio_feature_backfill_search", {
			p_song_id: fixture.songId,
			p_requested_by_account_id: fixture.accountId,
		});

		const manual = await db().rpc("enqueue_audio_feature_backfill_manual", {
			p_song_id: fixture.songId,
			p_source_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
			p_requested_by_account_id: fixture.accountId,
		});
		expect(manual.error).toBeNull();
		expect(manual.data?.source_type).toBe("youtube_url");

		const { data: autoRow } = await db()
			.from("audio_feature_backfill_job")
			.select("status")
			.eq("id", auto.data?.id ?? "")
			.single()
			.throwOnError();
		expect(autoRow?.status).toBe("obsolete");

		// Exactly one active job remains — the manual one.
		const { data: active } = await db()
			.from("audio_feature_backfill_job")
			.select("id, source_type")
			.eq("song_id", fixture.songId)
			.in("status", ["pending", "running"])
			.throwOnError();
		expect(active).toHaveLength(1);
		expect(active?.[0]?.source_type).toBe("youtube_url");
	});
});

describe.skipIf(!IS_LOCAL)("claim and fenced settlement", () => {
	it("claim leases a pending job; complete only honors the owning worker", async () => {
		if (!fixture) throw new Error("missing");
		await db().rpc("enqueue_audio_feature_backfill_search", {
			p_song_id: fixture.songId,
			p_requested_by_account_id: fixture.accountId,
		});

		const claim = await db().rpc("claim_pending_audio_feature_backfill_job", {
			p_worker_id: "worker-A",
			p_limit: 5,
			p_lease_seconds: 900,
		});
		expect(claim.error).toBeNull();
		const claimed = (claim.data ?? []).find(
			(j) => j.song_id === fixture?.songId,
		);
		expect(claimed?.status).toBe("running");
		expect(claimed?.locked_by).toBe("worker-A");

		// A different worker's settlement matches nothing (fence rejects it).
		const wrong = await db().rpc("complete_audio_feature_backfill_job", {
			p_job_id: claimed?.id ?? "",
			p_worker_id: "worker-B",
		});
		expect(wrong.error).toBeNull();
		expect(wrong.data ?? []).toHaveLength(0);

		// The owning worker completes it.
		const right = await db().rpc("complete_audio_feature_backfill_job", {
			p_job_id: claimed?.id ?? "",
			p_worker_id: "worker-A",
		});
		expect((right.data ?? [])[0]?.status).toBe("completed");
	});

	it("a stale running job (expired lease) is swept back to pending", async () => {
		if (!fixture) throw new Error("missing");
		await db()
			.from("audio_feature_backfill_job")
			.insert({
				song_id: fixture.songId,
				source_type: "youtube_search",
				status: "running",
				attempts: 1,
				max_attempts: 3,
				locked_by: "dead-worker",
				locked_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
				lease_expires_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
			})
			.throwOnError();

		const sweep = await db().rpc("sweep_stale_audio_feature_backfill_jobs");
		expect(sweep.error).toBeNull();
		const swept = (sweep.data ?? []).find((j) => j.song_id === fixture?.songId);
		expect(swept?.status).toBe("pending");
		expect(swept?.locked_by).toBeNull();
		// Attempts remained (1 < 3), so it requeues rather than failing terminally.
		expect(await stateOf(fixture.songId)).toBe("backfill_active");
	});

	it("a stale running job with attempts exhausted is swept to terminal failed", async () => {
		if (!fixture) throw new Error("missing");
		await db()
			.from("audio_feature_backfill_job")
			.insert({
				song_id: fixture.songId,
				source_type: "youtube_search",
				status: "running",
				attempts: 3,
				max_attempts: 3,
				locked_by: "dead-worker",
				locked_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
				lease_expires_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
			})
			.throwOnError();

		await db().rpc("sweep_stale_audio_feature_backfill_jobs").throwOnError();
		expect(await stateOf(fixture.songId)).toBe("unavailable_terminal");
		const availability = await availabilityOf(fixture.songId);
		expect(availability.error_code).toBe("lease_expired");
	});
});

describe.skipIf(!IS_LOCAL)("atomic fenced settlement", () => {
	const FEATURES = {
		acousticness: 0.2,
		danceability: 0.6,
		energy: 0.7,
		instrumentalness: 0.01,
		liveness: 0.1,
		loudness: -7,
		speechiness: 0.05,
		tempo: 120,
		valence: 0.5,
	};

	function settle(
		jobId: string,
		workerId: string,
		songId: string,
		sourceType: "youtube_search" | "youtube_url",
	) {
		return db().rpc("settle_audio_feature_backfill_job", {
			p_job_id: jobId,
			p_worker_id: workerId,
			p_song_id: songId,
			p_source_type: sourceType,
			p_features: FEATURES,
			p_review_status: sourceType === "youtube_url" ? "approved" : "pending",
			p_reviewed_by: sourceType === "youtube_url" ? "control-panel" : undefined,
			p_youtube_video_id: "dQw4w9WgXcQ",
			p_youtube_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
			p_youtube_title: "Artist - Song",
			p_youtube_channel: "Artist - Topic",
			p_youtube_duration_seconds: 200,
			p_youtube_thumbnail_url: undefined,
			p_search_query: "Artist Song",
			p_candidate_rank: 1,
			p_match_score: 0.95,
			p_match_reasons: ["title match"],
			p_rejected_candidates: [],
			p_clip_starts_seconds: [0, 60, 120],
			p_clip_features: [],
			p_aggregation_metadata: {},
		});
	}

	async function claimRunning(
		songId: string,
		workerId: string,
	): Promise<string> {
		await db().rpc("enqueue_audio_feature_backfill_search", {
			p_song_id: songId,
		});
		const claim = await db().rpc("claim_pending_audio_feature_backfill_job", {
			p_worker_id: workerId,
			p_limit: 5,
			p_lease_seconds: 900,
		});
		const claimed = (claim.data ?? []).find((j) => j.song_id === songId);
		if (!claimed) throw new Error("claim failed");
		return claimed.id;
	}

	it("writes feature + review + completes the job in one transaction", async () => {
		if (!fixture) throw new Error("missing");
		const jobId = await claimRunning(fixture.songId, "worker-A");

		const { data, error } = await settle(
			jobId,
			"worker-A",
			fixture.songId,
			"youtube_search",
		);
		expect(error).toBeNull();
		const row = (data ?? [])[0];
		expect(row?.did_skip).toBe(false);
		expect(row?.audio_feature_id).not.toBeNull();
		expect(row?.review_id).not.toBeNull();

		expect(await stateOf(fixture.songId)).toBe("ready");
		const { data: review } = await db()
			.from("audio_feature_source_review")
			.select("status, audio_feature_id")
			.eq("song_id", fixture.songId)
			.single()
			.throwOnError();
		expect(review?.status).toBe("pending");
		expect(review?.audio_feature_id).toBe(row?.audio_feature_id);
	});

	it("a non-owning worker is fenced out and writes nothing", async () => {
		if (!fixture) throw new Error("missing");
		const jobId = await claimRunning(fixture.songId, "worker-A");

		const { data } = await settle(
			jobId,
			"worker-B",
			fixture.songId,
			"youtube_search",
		);
		expect(data ?? []).toHaveLength(0);

		// No feature, no review, job still running for worker-A.
		const { count: featureCount } = await db()
			.from("song_audio_feature")
			.select("id", { count: "exact", head: true })
			.eq("song_id", fixture.songId);
		expect(featureCount).toBe(0);
		const { count: reviewCount } = await db()
			.from("audio_feature_source_review")
			.select("id", { count: "exact", head: true })
			.eq("song_id", fixture.songId);
		expect(reviewCount).toBe(0);
	});

	it("rejects (writes nothing) when the caller's song_id disagrees with the locked job", async () => {
		if (!fixture) throw new Error("missing");
		const jobId = await claimRunning(fixture.songId, "worker-A");

		// Correct worker + job, but a mismatched song_id: the RPC reads song_id off
		// the locked row and refuses rather than persisting against the wrong song.
		const { data } = await settle(
			jobId,
			"worker-A",
			crypto.randomUUID(),
			"youtube_search",
		);
		expect(data ?? []).toHaveLength(0);

		const { count } = await db()
			.from("song_audio_feature")
			.select("id", { count: "exact", head: true })
			.eq("song_id", fixture.songId);
		expect(count).toBe(0);
	});

	it("youtube_search skips (completes, no write) when a feature already landed", async () => {
		if (!fixture) throw new Error("missing");
		const jobId = await claimRunning(fixture.songId, "worker-A");
		await insertFeatureRow(fixture.songId);

		const { data } = await settle(
			jobId,
			"worker-A",
			fixture.songId,
			"youtube_search",
		);
		expect((data ?? [])[0]?.did_skip).toBe(true);

		// The job completed but no provenance review was created for the skip.
		const { data: job } = await db()
			.from("audio_feature_backfill_job")
			.select("status")
			.eq("id", jobId)
			.single()
			.throwOnError();
		expect(job?.status).toBe("completed");
		const { count: reviewCount } = await db()
			.from("audio_feature_source_review")
			.select("id", { count: "exact", head: true })
			.eq("song_id", fixture.songId);
		expect(reviewCount).toBe(0);
	});
});
