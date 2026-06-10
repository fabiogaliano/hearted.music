/**
 * RPC integration: grant_liked_song_access + is_waitlist_eligible_for_liked_song_grant.
 *
 * Exercises the SQL layer directly against the local Supabase Postgres (the
 * domain helper's applyLibraryProcessingChange builds its own admin client,
 * which the jsdom test env refuses — so we call the RPCs through the same
 * service-role client the app uses). Auto-skipped when SUPABASE_URL is not the
 * local URL.
 *
 * Builds the admin client from process.env directly because the production
 * createAdminSupabaseClient reads through the t3-env wrapper, which gates
 * server-only vars on `typeof window === 'undefined'`; vitest's jsdom env
 * defines `window`.
 */

import { createClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it } from "vitest";
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

function db() {
	if (!supabase) throw new Error("supabase client not initialised");
	return supabase;
}

const createdAccountIds: string[] = [];
const createdSongIds: string[] = [];
// Tracked by id, not email: PostgREST trims unquoted whitespace in `in.(...)`
// lists, so deleting a padded email like "  ws@example.com " by value misses.
const createdWaitlistIds: number[] = [];

async function seedAccount(opts: {
	email?: string | null;
	createdAt?: string;
}): Promise<string> {
	const id = crypto.randomUUID();
	await db()
		.from("account")
		.insert({
			id,
			spotify_id: `sp-${id}`,
			email: opts.email ?? null,
			...(opts.createdAt ? { created_at: opts.createdAt } : {}),
		})
		.throwOnError();
	createdAccountIds.push(id);
	return id;
}

async function seedLikedSongs(
	accountId: string,
	count: number,
): Promise<string[]> {
	const songIds = Array.from({ length: count }, () => crypto.randomUUID());

	await db()
		.from("song")
		.insert(
			songIds.map((id) => ({ id, spotify_id: `sp-${id}`, name: `Song ${id}` })),
		)
		.throwOnError();
	createdSongIds.push(...songIds);

	await db()
		.from("liked_song")
		.insert(
			songIds.map((songId, i) => ({
				account_id: accountId,
				song_id: songId,
				liked_at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
			})),
		)
		.throwOnError();

	return songIds;
}

async function seedWaitlist(email: string, createdAt: string): Promise<void> {
	const { data, error } = await db()
		.from("waitlist")
		.insert({ email, created_at: createdAt })
		.select("id")
		.single();
	if (error) throw error;
	createdWaitlistIds.push(data.id);
}

async function grant(args: {
	accountId: string;
	origin: "waitlist_auto" | "operator_manual";
	requestedBy?: string;
	note?: string;
}) {
	const { data, error } = await db().rpc("grant_liked_song_access", {
		p_account_id: args.accountId,
		p_origin: args.origin,
		...(args.requestedBy ? { p_requested_by: args.requestedBy } : {}),
		...(args.note ? { p_note: args.note } : {}),
	});
	if (error) throw error;
	return data as {
		status: "applied" | "already_applied" | "pending_no_liked_songs";
		candidate_count?: number;
		newly_unlocked_song_ids?: string[];
	};
}

async function isEligible(accountId: string): Promise<boolean> {
	const { data, error } = await db().rpc(
		"is_waitlist_eligible_for_liked_song_grant",
		{ p_account_id: accountId },
	);
	if (error) throw error;
	return data === true;
}

async function countUnlocks(accountId: string): Promise<number> {
	const { count, error } = await db()
		.from("account_song_unlock")
		.select("id", { count: "exact", head: true })
		.eq("account_id", accountId);
	if (error) throw error;
	return count ?? 0;
}

async function readGrantRow(accountId: string) {
	const { data, error } = await db()
		.from("account_liked_song_access_grant")
		.select("origin, requested_by, note, applied_at")
		.eq("account_id", accountId)
		.maybeSingle();
	if (error) throw error;
	return data;
}

// PostgREST encodes `.in("id", ids)` as an `id=in.(…)` query string, so a few
// hundred UUIDs blow past the server's URI length cap (~8 KB) and the DELETE
// comes back 414 — which supabase-js swallows without throwOnError, silently
// leaking every seeded row. (The cap test alone seeds 501.) Chunking keeps each
// request small; throwOnError makes any future cleanup failure loud instead of
// letting orphan rows pile up across runs.
const CLEANUP_CHUNK = 100;

function chunk<T>(items: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) {
		out.push(items.slice(i, i + size));
	}
	return out;
}

afterEach(async () => {
	if (!supabase) return;
	if (createdAccountIds.length > 0) {
		for (const ids of chunk(createdAccountIds, CLEANUP_CHUNK)) {
			await supabase.from("account").delete().in("id", ids).throwOnError();
		}
		createdAccountIds.length = 0;
	}
	if (createdSongIds.length > 0) {
		for (const ids of chunk(createdSongIds, CLEANUP_CHUNK)) {
			await supabase.from("song").delete().in("id", ids).throwOnError();
		}
		createdSongIds.length = 0;
	}
	if (createdWaitlistIds.length > 0) {
		for (const ids of chunk(createdWaitlistIds, CLEANUP_CHUNK)) {
			await supabase.from("waitlist").delete().in("id", ids).throwOnError();
		}
		createdWaitlistIds.length = 0;
	}
});

describe.skipIf(!IS_LOCAL)("grant_liked_song_access", () => {
	it("first apply on a synced account unlocks the top songs and marks applied", async () => {
		const accountId = await seedAccount({ email: "first@test.dev" });
		const songIds = await seedLikedSongs(accountId, 3);

		const result = await grant({ accountId, origin: "operator_manual" });

		expect(result.status).toBe("applied");
		expect(result.candidate_count).toBe(3);
		expect(result.newly_unlocked_song_ids?.sort()).toEqual([...songIds].sort());

		const { data: unlocks } = await db()
			.from("account_song_unlock")
			.select("source")
			.eq("account_id", accountId);
		expect(unlocks).toHaveLength(3);
		expect(unlocks?.every((u) => u.source === "grant")).toBe(true);

		const row = await readGrantRow(accountId);
		expect(row?.applied_at).not.toBeNull();
	});

	it("an unsynced account returns pending_no_liked_songs and creates a pending row", async () => {
		const accountId = await seedAccount({ email: "pending@test.dev" });

		const result = await grant({ accountId, origin: "operator_manual" });

		expect(result.status).toBe("pending_no_liked_songs");
		const row = await readGrantRow(accountId);
		expect(row).not.toBeNull();
		expect(row?.applied_at).toBeNull();
	});

	it("a later sync applies a previously pending grant", async () => {
		const accountId = await seedAccount({ email: "later@test.dev" });

		const pending = await grant({ accountId, origin: "operator_manual" });
		expect(pending.status).toBe("pending_no_liked_songs");

		await seedLikedSongs(accountId, 2);

		const applied = await grant({ accountId, origin: "operator_manual" });
		expect(applied.status).toBe("applied");
		expect(applied.candidate_count).toBe(2);
		expect(await countUnlocks(accountId)).toBe(2);
	});

	it("rerunning after apply returns already_applied", async () => {
		const accountId = await seedAccount({ email: "rerun@test.dev" });
		await seedLikedSongs(accountId, 2);

		expect((await grant({ accountId, origin: "operator_manual" })).status).toBe(
			"applied",
		);
		expect((await grant({ accountId, origin: "operator_manual" })).status).toBe(
			"already_applied",
		);
		expect(await countUnlocks(accountId)).toBe(2);
	});

	it("a library with fewer than 500 songs unlocks all of them", async () => {
		const accountId = await seedAccount({ email: "small@test.dev" });
		await seedLikedSongs(accountId, 5);

		const result = await grant({ accountId, origin: "operator_manual" });
		expect(result.status).toBe("applied");
		expect(result.candidate_count).toBe(5);
		expect(result.newly_unlocked_song_ids).toHaveLength(5);
	});

	it("caps the snapshot at the current top 500 liked songs", async () => {
		const accountId = await seedAccount({ email: "cap@test.dev" });
		const songIds = await seedLikedSongs(accountId, 501);

		const result = await grant({ accountId, origin: "operator_manual" });
		expect(result.status).toBe("applied");
		expect(result.candidate_count).toBe(500);
		expect(result.newly_unlocked_song_ids).toHaveLength(500);
		expect(result.newly_unlocked_song_ids?.sort()).toEqual(
			[...songIds.slice(1)].sort(),
		);
		expect(await countUnlocks(accountId)).toBe(500);
	}, 15_000);

	it("marks applied with no duplicate rows when all candidates are already unlocked", async () => {
		const accountId = await seedAccount({ email: "dup@test.dev" });
		const songIds = await seedLikedSongs(accountId, 3);

		// Pre-unlock every liked song via a different source.
		await db()
			.rpc("insert_song_unlocks_without_charge", {
				p_account_id: accountId,
				p_song_ids: songIds,
				p_source: "admin",
			})
			.throwOnError();
		expect(await countUnlocks(accountId)).toBe(3);

		const result = await grant({ accountId, origin: "operator_manual" });
		expect(result.status).toBe("applied");
		expect(result.candidate_count).toBe(3);
		expect(result.newly_unlocked_song_ids).toHaveLength(0);
		// Still 3 rows — no duplicates created.
		expect(await countUnlocks(accountId)).toBe(3);
		expect((await readGrantRow(accountId))?.applied_at).not.toBeNull();
	});

	it("reruns do not overwrite origin, requested_by, or note", async () => {
		const accountId = await seedAccount({ email: "audit@test.dev" });
		await seedLikedSongs(accountId, 1);

		await grant({
			accountId,
			origin: "waitlist_auto",
			requestedBy: "first-writer",
			note: "original",
		});
		await grant({
			accountId,
			origin: "operator_manual",
			requestedBy: "second-writer",
			note: "overwrite-attempt",
		});

		const row = await readGrantRow(accountId);
		expect(row?.origin).toBe("waitlist_auto");
		expect(row?.requested_by).toBe("first-writer");
		expect(row?.note).toBe("original");
	});
});

describe.skipIf(!IS_LOCAL)("is_waitlist_eligible_for_liked_song_grant", () => {
	const ACCOUNT_CREATED_AT = "2026-05-01T00:00:00.000Z";
	const BEFORE = "2026-04-01T00:00:00.000Z";
	const AFTER = "2026-06-01T00:00:00.000Z";

	it("matches across case differences", async () => {
		const accountId = await seedAccount({
			email: "Case@Example.com",
			createdAt: ACCOUNT_CREATED_AT,
		});
		await seedWaitlist("case@example.com", BEFORE);
		expect(await isEligible(accountId)).toBe(true);
	});

	it("matches across surrounding whitespace", async () => {
		const accountId = await seedAccount({
			email: "ws@example.com",
			createdAt: ACCOUNT_CREATED_AT,
		});
		await seedWaitlist("  ws@example.com ", BEFORE);
		expect(await isEligible(accountId)).toBe(true);
	});

	it("is eligible when the waitlist row predates the account", async () => {
		const accountId = await seedAccount({
			email: "before@example.com",
			createdAt: ACCOUNT_CREATED_AT,
		});
		await seedWaitlist("before@example.com", BEFORE);
		expect(await isEligible(accountId)).toBe(true);
	});

	it("is not eligible when the waitlist row is created after the account", async () => {
		const accountId = await seedAccount({
			email: "after@example.com",
			createdAt: ACCOUNT_CREATED_AT,
		});
		await seedWaitlist("after@example.com", AFTER);
		expect(await isEligible(accountId)).toBe(false);
	});

	it("is not eligible once a grant row already exists", async () => {
		const accountId = await seedAccount({
			email: "hasgrant@example.com",
			createdAt: ACCOUNT_CREATED_AT,
		});
		await seedWaitlist("hasgrant@example.com", BEFORE);
		expect(await isEligible(accountId)).toBe(true);

		await db()
			.from("account_liked_song_access_grant")
			.insert({ account_id: accountId, origin: "operator_manual" })
			.throwOnError();

		expect(await isEligible(accountId)).toBe(false);
	});

	it("is not eligible for an account with a null email", async () => {
		const accountId = await seedAccount({
			email: null,
			createdAt: ACCOUNT_CREATED_AT,
		});
		await seedWaitlist("anything@example.com", BEFORE);
		expect(await isEligible(accountId)).toBe(false);
	});

	it("the normalized unique index rejects a case/whitespace variant", async () => {
		await seedWaitlist("Dup@Example.com", BEFORE);
		const { error } = await db()
			.from("waitlist")
			.insert({ email: "  dup@example.com " });
		expect(error?.code).toBe("23505");
	});

	it("applies a manual pending grant even when the account is not waitlist-eligible", async () => {
		const accountId = await seedAccount({ email: "manual-only@example.com" });
		// No waitlist row → not eligible.
		expect(await isEligible(accountId)).toBe(false);

		// Operator creates a pending grant on the unsynced account.
		const pending = await grant({ accountId, origin: "operator_manual" });
		expect(pending.status).toBe("pending_no_liked_songs");

		// A later sync populates liked songs and re-applies — succeeds despite
		// the account never being waitlist-eligible.
		await seedLikedSongs(accountId, 2);
		const applied = await grant({ accountId, origin: "operator_manual" });
		expect(applied.status).toBe("applied");
		expect(await countUnlocks(accountId)).toBe(2);
	});
});
