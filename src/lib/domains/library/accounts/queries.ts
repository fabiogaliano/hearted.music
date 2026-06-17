/**
 * Account data operations.
 *
 * Uses service role client to bypass RLS since we use custom auth.
 * Returns Result<T, DbError> for composable error handling.
 */

import { Result } from "better-result";
import { env } from "@/env";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { Tables, TablesInsert } from "@/lib/data/database.types";
import type { DbError } from "@/lib/shared/errors/database";
import {
	fromSupabaseMaybe,
	fromSupabaseSingle,
} from "@/lib/shared/utils/result-wrappers/supabase";

/** Public identity shape for the /@handle route. Only handle + avatar. */
export interface PublicHandleIdentity {
	handle: string;
	imageUrl: string | null;
}

/** Account row type */
export type Account = Tables<"account">;

/**
 * Account plus its last-seen heartbeat, read together on the auth path so the
 * caller can decide whether the throttled write is due without a second query.
 */
export interface AccountWithActivity {
	account: Account;
	lastSeenAt: string | null;
}

/** Insert type - only the fields we use for upsert */
type UpsertAccountData = Pick<
	TablesInsert<"account">,
	"spotify_id" | "email" | "display_name"
>;

/** Data for creating an account linked to a Better Auth user (no spotify_id yet) */
export interface CreateBetterAuthAccountData {
	better_auth_user_id: string;
	email: string;
	display_name: string;
}

/**
 * Gets an account by its UUID.
 * Returns null if not found (not an error).
 */
export function getAccountById(
	id: string,
): Promise<Result<Account | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMaybe(
		supabase.from("account").select("*").eq("id", id).single(),
	);
}

/**
 * Gets an account by Spotify user ID.
 * Returns null if not found (not an error).
 */
export function getAccountBySpotifyId(
	spotifyId: string,
): Promise<Result<Account | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMaybe(
		supabase.from("account").select("*").eq("spotify_id", spotifyId).single(),
	);
}

/**
 * Creates or updates an account based on Spotify ID.
 * Returns the account (existing or newly created).
 */
export function upsertAccount(
	data: UpsertAccountData,
): Promise<Result<Account, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseSingle(
		supabase
			.from("account")
			.upsert(
				{
					spotify_id: data.spotify_id,
					email: data.email,
					display_name: data.display_name,
				},
				{ onConflict: "spotify_id" },
			)
			.select()
			.single(),
	);
}

/**
 * Gets an account by its Better Auth user ID, plus its last_seen_at heartbeat.
 * Used after Better Auth session validation to find our app account.
 *
 * Embeds account_activity into the same read (no extra round-trip) so the auth
 * path can gate the throttled heartbeat write in-process. account_activity is
 * one-to-one with account, so the embed resolves to an object or null.
 */
export async function getAccountByBetterAuthUserId(
	userId: string,
): Promise<Result<AccountWithActivity | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	const result = await fromSupabaseMaybe(
		supabase
			.from("account")
			.select("*, account_activity(last_seen_at)")
			.eq("better_auth_user_id", userId)
			.single(),
	);

	if (Result.isError(result)) return result;
	if (result.value === null) return Result.ok(null);

	const { account_activity, ...account } = result.value;
	return Result.ok({
		account,
		lastSeenAt: account_activity?.last_seen_at ?? null,
	});
}

/**
 * Records that the account was just seen. Throttled in SQL to at most one write
 * per 10-minute window (see touch_account_last_seen), so it's safe to call on
 * every authenticated request. Fire-and-forget: callers run it after the
 * response via waitUntil, and its failure must never affect the request.
 */
export async function touchAccountLastSeen(accountId: string): Promise<void> {
	const supabase = createAdminSupabaseClient();
	await supabase.rpc("touch_account_last_seen", { p_account_id: accountId });
}

/**
 * Creates an account record linked to a Better Auth user.
 * Called from Better Auth's databaseHooks.user.create.after hook
 * on first social login. spotify_id is null until first extension sync.
 *
 * Always provisions an account_billing row alongside the account.
 * In self-hosted mode (BILLING_ENABLED=false), sets unlimited_access_source='self_hosted'
 * and reprioritizes any pending jobs for the new account.
 */
export async function createAccountForBetterAuthUser(
	data: CreateBetterAuthAccountData,
): Promise<Result<Account, DbError>> {
	const supabase = createAdminSupabaseClient();

	// account + account_billing are provisioned in one transaction by the RPC.
	// Two app-side inserts could leave an account without a billing row on a
	// mid-call failure: reads self-heal to free tier, but a self-hosted
	// unlimited_access_source would be silently lost.
	const accountResult = await fromSupabaseSingle(
		supabase.rpc("create_account_with_billing", {
			p_better_auth_user_id: data.better_auth_user_id,
			p_email: data.email,
			p_display_name: data.display_name,
			...(env.BILLING_ENABLED
				? {}
				: { p_unlimited_access_source: "self_hosted" as const }),
		}),
	);

	if (Result.isError(accountResult)) return accountResult;

	const account = accountResult.value;

	if (!env.BILLING_ENABLED) {
		await supabase.rpc("reprioritize_pending_jobs_for_account", {
			p_account_id: account.id,
		});
	}

	return Result.ok(account);
}

/**
 * Looks up a public handle identity for the /@handle route.
 *
 * Inner-joins user_preferences so that accounts whose onboarding is not yet
 * complete (onboarding_completed_at IS NULL) are excluded at the query level —
 * no row is returned for them, meaning the route correctly shows notFound.
 *
 * Returns null when no live public handle exists (not an error). Returns
 * Result.err for multiplicity violations or other DB failures — these must not
 * be silently collapsed to null because they indicate unexpected data state.
 */
export async function getPublicHandleIdentityByHandle(
	handle: string,
): Promise<Result<PublicHandleIdentity | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	const canonicalHandle = handle.toLowerCase();

	// Select handle + image_url from account, inner-joining user_preferences
	// so rows without a completed onboarding_completed_at are filtered out.
	// maybeSingle() enforces the 0-or-1 cardinality contract: handle is unique
	// per DB constraint, and each account has at most one user_preferences row.
	const result = await fromSupabaseMaybe(
		supabase
			.from("account")
			.select(
				"handle, image_url, user_preferences!inner(onboarding_completed_at)",
			)
			.eq("handle", canonicalHandle)
			.not("user_preferences.onboarding_completed_at", "is", null)
			.maybeSingle(),
	);

	if (Result.isError(result)) {
		return result;
	}

	if (result.value === null) {
		return Result.ok(null);
	}

	// handle is guaranteed non-null because we filter eq("handle", canonicalHandle).
	// The DB column is nullable by schema but our eq filter ensures a match.
	return Result.ok({
		handle: result.value.handle ?? canonicalHandle,
		imageUrl: result.value.image_url,
	});
}
