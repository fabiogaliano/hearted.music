/**
 * Selector lifecycle suppression — exercises migration
 * 20260426180000_job_failure_lifecycle (table since renamed to job_item_failure). Verifies that the work-plan selector
 * uses suppress_until / resolved_at instead of raw failure-row existence:
 *
 *   - terminal failures still exclude the song entirely (CTE terminal gate)
 *   - non-terminal failures with suppress_until > now() suppress that stage
 *   - non-terminal failures whose suppress_until has elapsed do NOT suppress
 *     (auto-recovery)
 *   - resolved rows (resolved_at IS NOT NULL) do not suppress
 *
 * Runs against the local Supabase Postgres only — auto-skipped when
 * SUPABASE_URL is not the local URL so CI without a local stack is unaffected.
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
			name: "Test Song",
			artists: ["Artist"],
			artist_ids: ["art-1"],
			genres: [],
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
	"select_liked_song_ids_needing_enrichment_work: lifecycle suppression",
	() => {
		it("baseline: song with no failure rows needs audio_features and genre_tagging", async () => {
			if (!supabase || !fixture) throw new Error("missing");
			const f = fixture;
			const rows = await callSelector(fixture.accountId);
			const row = rows.find((r) => r.song_id === f.songId);
			expect(row).toBeDefined();
			expect(row?.needs_audio_features).toBe(true);
			expect(row?.needs_genre_tagging).toBe(true);
		});

		it("non-terminal failure with active suppress_until suppresses the stage", async () => {
			if (!supabase || !fixture) throw new Error("missing");
			const f = fixture;
			const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();

			await supabase
				.from("job_item_failure")
				.insert({
					job_id: fixture.jobId,
					item_type: "song",
					item_id: fixture.songId,
					stage: "audio_features",
					failure_code: "provider_unavailable",
					is_terminal: false,
					suppress_until: future,
				})
				.throwOnError();

			const rows = await callSelector(fixture.accountId);
			const row = rows.find((r) => r.song_id === f.songId);
			expect(row?.needs_audio_features).toBe(false);
			// Other stages still need work
			expect(row?.needs_genre_tagging).toBe(true);
		});

		it("expired suppress_until does NOT suppress (auto-recovery)", async () => {
			if (!supabase || !fixture) throw new Error("missing");
			const f = fixture;
			const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();

			await supabase
				.from("job_item_failure")
				.insert({
					job_id: fixture.jobId,
					item_type: "song",
					item_id: fixture.songId,
					stage: "audio_features",
					failure_code: "provider_transient",
					is_terminal: false,
					suppress_until: past,
				})
				.throwOnError();

			const rows = await callSelector(fixture.accountId);
			const row = rows.find((r) => r.song_id === f.songId);
			expect(row?.needs_audio_features).toBe(true);
		});

		it("resolved_at set means the row no longer suppresses, even with future suppress_until", async () => {
			if (!supabase || !fixture) throw new Error("missing");
			const f = fixture;
			const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();

			await supabase
				.from("job_item_failure")
				.insert({
					job_id: fixture.jobId,
					item_type: "song",
					item_id: fixture.songId,
					stage: "genre_tagging",
					failure_code: "provider_transient",
					is_terminal: false,
					suppress_until: future,
					resolved_at: new Date().toISOString(),
				})
				.throwOnError();

			const rows = await callSelector(fixture.accountId);
			const row = rows.find((r) => r.song_id === f.songId);
			expect(row?.needs_genre_tagging).toBe(true);
		});

		it("terminal failure excludes the song entirely (no row returned)", async () => {
			if (!supabase || !fixture) throw new Error("missing");
			const f = fixture;
			await supabase
				.from("job_item_failure")
				.insert({
					job_id: fixture.jobId,
					item_type: "song",
					item_id: fixture.songId,
					stage: "song_analysis",
					failure_code: "analysis_inputs_missing",
					is_terminal: true,
				})
				.throwOnError();

			const rows = await callSelector(fixture.accountId);
			expect(rows.find((r) => r.song_id === f.songId)).toBeUndefined();
		});

		it("song_analysis stage suppression: active suppress_until blocks needs_analysis", async () => {
			if (!supabase || !fixture) throw new Error("missing");
			const f = fixture;
			const future = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();

			await supabase
				.from("job_item_failure")
				.insert({
					job_id: fixture.jobId,
					item_type: "song",
					item_id: fixture.songId,
					stage: "song_analysis",
					failure_code: "analysis_blocked_both_unavailable",
					is_terminal: false,
					suppress_until: future,
				})
				.throwOnError();

			const rows = await callSelector(fixture.accountId);
			const row = rows.find((r) => r.song_id === f.songId);
			expect(row?.needs_analysis).toBe(false);
		});

		it("resolve_job_item_stage_failures RPC clears suppression so stage is selectable again", async () => {
			if (!supabase || !fixture) throw new Error("missing");
			const f = fixture;
			const future = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();

			await supabase
				.from("job_item_failure")
				.insert({
					job_id: fixture.jobId,
					item_type: "song",
					item_id: fixture.songId,
					stage: "audio_features",
					failure_code: "provider_unavailable",
					is_terminal: false,
					suppress_until: future,
				})
				.throwOnError();

			let rows = await callSelector(fixture.accountId);
			let row = rows.find((r) => r.song_id === f.songId);
			expect(row?.needs_audio_features).toBe(false);

			const { error: rpcError } = await supabase.rpc(
				"resolve_job_item_stage_failures",
				{
					p_account_id: fixture.accountId,
					p_item_id: fixture.songId,
					p_stage: "audio_features",
				},
			);
			expect(rpcError).toBeNull();

			rows = await callSelector(fixture.accountId);
			row = rows.find((r) => r.song_id === f.songId);
			expect(row?.needs_audio_features).toBe(true);
		});

		it("count_unresolved_job_item_failures RPC returns active count for stage+code", async () => {
			if (!supabase || !fixture) throw new Error("missing");
			const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();

			await supabase
				.from("job_item_failure")
				.insert([
					{
						job_id: fixture.jobId,
						item_type: "song",
						item_id: fixture.songId,
						stage: "audio_features",
						failure_code: "provider_transient",
						is_terminal: false,
						suppress_until: future,
					},
					{
						job_id: fixture.jobId,
						item_type: "song",
						item_id: fixture.songId,
						stage: "audio_features",
						failure_code: "provider_transient",
						is_terminal: false,
						suppress_until: future,
					},
				])
				.throwOnError();

			const { data, error } = await supabase.rpc(
				"count_unresolved_job_item_failures",
				{
					p_account_id: fixture.accountId,
					p_item_id: fixture.songId,
					p_stage: "audio_features",
					p_failure_code: "provider_transient",
				},
			);
			expect(error).toBeNull();
			expect(data).toBe(2);
		});
	},
);
