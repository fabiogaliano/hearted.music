/**
 * §8.2 — Hardened selector: embedding input-gate + content_activation suppression.
 *
 * Exercises the two surgical changes from migration 20260612072059_harden_enrichment_selector:
 *
 * Change 1 — needs_embedding requires song_analysis to exist.
 *   A song with no analysis row must NOT appear as needs_embedding = true even
 *   when no song_embedding row exists either. Only once an analysis row is present
 *   should needs_embedding become true.
 *
 * Change 2 — needs_content_activation honours active suppress_until windows.
 *   An active content_activation failure suppression must mask the flag until
 *   the window lapses. After it lapses the song should reappear as needing
 *   content_activation.
 *
 * Also verifies the original incident scenario: a song with active analysis
 * suppression (analysis_blocked_lyrics_unavailable) and no analysis row is
 * returned by NO flag — fixing the hot-loop the incident account experienced.
 *
 * Runs against local Supabase only — auto-skipped when SUPABASE_URL is not
 * the local URL so CI without a local stack is unaffected.
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

// pgvector dimension for song_embedding
const ZERO_VECTOR = `[${new Array(512).fill(0).join(",")}]`;

interface Fixture {
	accountId: string;
	songId: string;
	jobId: string;
}

async function makeFixture(): Promise<Fixture> {
	if (!supabase) throw new Error("supabase client not initialised");

	const accountId = crypto.randomUUID();
	const songId = crypto.randomUUID();

	await supabase
		.from("account")
		.insert({ id: accountId, spotify_id: `test-${accountId}` })
		.throwOnError();

	await supabase
		.from("account_billing")
		.insert({
			account_id: accountId,
			plan: "free",
			unlimited_access_source: null,
			subscription_status: "none",
		})
		.throwOnError();

	await supabase
		.from("song")
		.insert({
			id: songId,
			spotify_id: `sp-${songId}`,
			name: "Crossing Paths (test)",
			artists: ["Brock Berrigan (test)"],
			artist_ids: ["art-test-1"],
			// Pre-populated genres so needs_genre_tagging = false from the start.
			genres: ["funk", "beats", "instrumental hip-hop"],
		})
		.throwOnError();

	// Pre-populate audio features so needs_audio_features = false from the start.
	// This isolates the test to analysis/embedding/content_activation flags only.
	await supabase
		.from("song_audio_feature")
		.insert({
			song_id: songId,
			tempo: 120,
			energy: 0.5,
			valence: 0.5,
			instrumentalness: 0.95,
			danceability: 0.5,
			loudness: -10,
			speechiness: 0.05,
			acousticness: 0.1,
			liveness: 0.1,
			mode: 1,
			key: 0,
			time_signature: 4,
		})
		.throwOnError();

	await supabase
		.from("liked_song")
		.insert({
			account_id: accountId,
			song_id: songId,
			liked_at: new Date().toISOString(),
		})
		.throwOnError();

	await supabase
		.from("account_song_unlock")
		.insert({ account_id: accountId, song_id: songId, source: "free_auto" })
		.throwOnError();

	const { data: job } = await supabase
		.from("job")
		.insert({ account_id: accountId, type: "enrichment" })
		.select("id")
		.single()
		.throwOnError();

	if (!job) throw new Error("failed to create test job");
	return { accountId, songId, jobId: job.id };
}

async function teardownFixture(f: Fixture) {
	if (!supabase) return;
	await supabase.from("account").delete().eq("id", f.accountId).throwOnError();
	await supabase.from("song").delete().eq("id", f.songId).throwOnError();
}

async function callSelector(accountId: string) {
	if (!supabase) throw new Error("supabase client not initialised");
	const { data, error } = await supabase.rpc(
		"select_liked_song_ids_needing_enrichment_work",
		{ p_account_id: accountId, p_limit: 50 },
	);
	if (error) throw error;
	return data ?? [];
}

async function insertAnalysis(songId: string) {
	if (!supabase) throw new Error("supabase client not initialised");
	await supabase
		.from("song_analysis")
		.insert({
			song_id: songId,
			analysis: { headline: "Test", kind: "instrumental" },
			model: "test-model",
			prompt_version: "test-v1",
		})
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

describe.skipIf(!IS_LOCAL)(
	"select_liked_song_ids_needing_enrichment_work: §8.2 embedding gate + content_activation suppression",
	() => {
		// ── Change 1: needs_embedding input-gate ──────────────────────────────────

		it("no analysis row → needs_embedding is FALSE (blocked song does not pollute the work queue)", async () => {
			// The incident scenario: Crossing Paths had no analysis row (analysis
			// blocked by GeniusParseError) but needs_embedding was true, driving a
			// hot loop. With Change 1 applied, needs_embedding must be false when
			// there is no analysis row.
			// Audio features + genres are pre-seeded so only analysis/embedding flags vary.
			if (!supabase || !fixture) throw new Error("missing");
			const f = fixture;

			const rows = await callSelector(f.accountId);
			const row = rows.find((r) => r.song_id === f.songId);

			// Song appears (needs_analysis is true) but needs_embedding is false
			expect(row).toBeDefined();
			expect(row?.needs_embedding).toBe(false);
			expect(row?.needs_analysis).toBe(true);
			expect(row?.needs_audio_features).toBe(false);
			expect(row?.needs_genre_tagging).toBe(false);
		});

		it("analysis present + no embedding → needs_embedding is TRUE", async () => {
			if (!supabase || !fixture) throw new Error("missing");
			const f = fixture;

			await insertAnalysis(f.songId);

			// Settle the lyrics outcome (confirmed instrumental) so the lyrics-refresh
			// probe does not re-open needs_analysis — this isolates the embedding gate.
			await supabase
				.from("song_lyrics")
				.insert({
					song_id: f.songId,
					source: "genius",
					document: null,
					content_hash: "no-content",
					has_annotations: false,
					schema_version: 0,
					fetch_status: "instrumental",
					fetch_source: "genius",
				})
				.throwOnError();

			const rows = await callSelector(f.accountId);
			const row = rows.find((r) => r.song_id === f.songId);

			expect(row).toBeDefined();
			expect(row?.needs_embedding).toBe(true);
			expect(row?.needs_analysis).toBe(false);
		});

		it("analysis present + embedding present → needs_embedding is FALSE", async () => {
			if (!supabase || !fixture) throw new Error("missing");
			const f = fixture;

			await insertAnalysis(f.songId);

			await supabase
				.from("song_embedding")
				.insert({
					song_id: f.songId,
					kind: "song_analysis",
					model: "test-model",
					model_version: "1",
					dims: 512,
					content_hash: "test-hash-embed",
					embedding: ZERO_VECTOR,
				})
				.throwOnError();

			const rows = await callSelector(f.accountId);
			const row = rows.find((r) => r.song_id === f.songId);

			// Fully enriched — may still appear for other stages but not embedding
			expect(row?.needs_embedding ?? false).toBe(false);
		});

		it("embedding older than the latest analysis → needs_embedding is TRUE (stale refresh)", async () => {
			// A re-analysis (late lyrics) writes a newer analysis row; an embedding
			// created before it is stale and must be re-offered so the refreshed,
			// lyrics-informed analysis embeds instead of keeping the old vector.
			if (!supabase || !fixture) throw new Error("missing");
			const f = fixture;

			await insertAnalysis(f.songId);

			const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
			await supabase
				.from("song_embedding")
				.insert({
					song_id: f.songId,
					kind: "song_analysis",
					model: "test-model",
					model_version: "1",
					dims: 512,
					content_hash: "stale-embed-hash",
					embedding: ZERO_VECTOR,
					created_at: past,
				})
				.throwOnError();

			const rows = await callSelector(f.accountId);
			const row = rows.find((r) => r.song_id === f.songId);

			expect(row?.needs_embedding).toBe(true);
		});

		// ── Incident scenario: blocked analysis + no analysis row ─────────────────

		it("active analysis_blocked_lyrics_unavailable + no analysis row → song returned by NO flag", async () => {
			// Exact incident pattern: analysis blocked (active suppress_until),
			// no analysis row, no embedding. With the hardened selector both
			// needs_analysis (suppressed) and needs_embedding (no analysis row) are
			// false, so the song should not appear at all.
			if (!supabase || !fixture) throw new Error("missing");
			const f = fixture;

			const future = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
			await supabase
				.from("job_item_failure")
				.insert({
					job_id: f.jobId,
					item_type: "song",
					item_id: f.songId,
					stage: "song_analysis",
					failure_code: "analysis_blocked_lyrics_unavailable",
					is_terminal: false,
					suppress_until: future,
				})
				.throwOnError();

			const rows = await callSelector(f.accountId);
			// Song should not appear at all (all flags false → filtered out by WHERE)
			expect(rows.find((r) => r.song_id === f.songId)).toBeUndefined();
		});

		// ── Change 2: needs_content_activation suppression ────────────────────────

		it("analysis present + active content_activation suppression → needs_content_activation is FALSE", async () => {
			// Previously CONTENT_ACTIVATION_FAILED wrote a suppress_until window
			// but the selector never checked it (dead code). Change 2 makes it live.
			if (!supabase || !fixture) throw new Error("missing");
			const f = fixture;

			await insertAnalysis(f.songId);

			const future = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
			await supabase
				.from("job_item_failure")
				.insert({
					job_id: f.jobId,
					item_type: "song",
					item_id: f.songId,
					stage: "content_activation",
					failure_code: "content_activation_failed",
					is_terminal: false,
					suppress_until: future,
				})
				.throwOnError();

			const rows = await callSelector(f.accountId);
			const row = rows.find((r) => r.song_id === f.songId);

			// Needs embedding (analysis present, no embedding) but NOT content_activation
			expect(row?.needs_content_activation).toBe(false);
			expect(row?.needs_embedding).toBe(true);
		});

		it("analysis present + lapsed content_activation suppress_until → needs_content_activation is TRUE again", async () => {
			if (!supabase || !fixture) throw new Error("missing");
			const f = fixture;

			await insertAnalysis(f.songId);

			const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
			await supabase
				.from("job_item_failure")
				.insert({
					job_id: f.jobId,
					item_type: "song",
					item_id: f.songId,
					stage: "content_activation",
					failure_code: "content_activation_failed",
					is_terminal: false,
					suppress_until: past,
				})
				.throwOnError();

			const rows = await callSelector(f.accountId);
			const row = rows.find((r) => r.song_id === f.songId);

			// Lapsed window: song reappears for content_activation
			expect(row?.needs_content_activation).toBe(true);
		});

		it("analysis present + resolved content_activation failure → needs_content_activation is TRUE (not suppressed)", async () => {
			if (!supabase || !fixture) throw new Error("missing");
			const f = fixture;

			await insertAnalysis(f.songId);

			const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
			await supabase
				.from("job_item_failure")
				.insert({
					job_id: f.jobId,
					item_type: "song",
					item_id: f.songId,
					stage: "content_activation",
					failure_code: "content_activation_failed",
					is_terminal: false,
					suppress_until: future,
					resolved_at: new Date().toISOString(),
				})
				.throwOnError();

			const rows = await callSelector(f.accountId);
			const row = rows.find((r) => r.song_id === f.songId);

			// resolved_at set → suppression row is cleared → stage is actionable
			expect(row?.needs_content_activation).toBe(true);
		});
	},
);
