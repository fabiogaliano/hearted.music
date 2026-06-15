/**
 * Operations registry — the "run scripts from the app" surface.
 *
 * Each operation is self-describing (id, title, fields) so the UI renders its
 * form generically and adding a new op is a single entry here. v1 wires the
 * liked-song access grant, replicating scripts/ops/grant-liked-song-access.ts:
 * resolve account → preview (dry run) → grantLikedSongAccessForAccount.
 *
 * We call the shared grantLikedSongAccessForAccount (not the bare RPC) so the
 * grant fires the exact same library-processing side effect the website does —
 * the songs_unlocked change that kicks off enrichment for the newly-unlocked
 * songs. That helper builds its own admin client from @/env, which env-bootstrap
 * (preloaded before this module) has pointed at PROD; without that preload it
 * would target the local dev db. See control-panel/server/env-bootstrap.ts.
 */

import { createAdminSupabaseClient } from "@/lib/data/client";
import { grantLikedSongAccessForAccount } from "@/lib/domains/billing/liked-song-access-grant";
import { Result } from "better-result";
import { prodSupabase } from "./supabase";

export interface OperationField {
	name: string;
	label: string;
	type: "select" | "text" | "number" | "account";
	required?: boolean;
	placeholder?: string;
	options?: { value: string; label: string }[];
	// `number` fields: initial value + clamp range surfaced to the input.
	default?: string;
	min?: number;
	max?: number;
}

export interface OperationDef {
	id: string;
	title: string;
	description: string;
	danger: boolean;
	supportsDryRun: boolean;
	fields: OperationField[];
}

// Mirrors the RPC's clamp range (see the grant_liked_song_access migration).
const DEFAULT_GRANT_LIMIT = 500;
const MIN_GRANT_LIMIT = 1;
const MAX_GRANT_LIMIT = 10000;

export const OPERATIONS: OperationDef[] = [
	{
		id: "grant-liked-access",
		title: "Grant liked-song access",
		description: `Unlock the top N liked songs for a verified account (default ${DEFAULT_GRANT_LIMIT}, origin: operator_manual). Pick a verified user with a synced library — the grant applies immediately.`,
		danger: false,
		supportsDryRun: true,
		fields: [
			{
				name: "accountId",
				label: "Account",
				type: "account",
				required: true,
				placeholder: "Search verified users…",
			},
			{
				name: "limit",
				label: "Number of songs to unlock",
				type: "number",
				required: true,
				default: String(DEFAULT_GRANT_LIMIT),
				min: MIN_GRANT_LIMIT,
				max: MAX_GRANT_LIMIT,
			},
			{
				name: "reason",
				label: "Reason (audit note)",
				type: "text",
				placeholder: "VIP / support request",
			},
			{
				name: "requestedBy",
				label: "Requested by (audit)",
				type: "text",
				placeholder: "ops@hearted",
			},
		],
	},
];

export interface OperationResult {
	ok: boolean;
	status: string;
	message: string;
	details?: Record<string, unknown>;
}

function escapeLikePattern(value: string): string {
	return value.replace(/([\\%_])/g, "\\$1");
}

interface TargetAccount {
	id: string;
	email: string | null;
	spotify_id: string | null;
	display_name: string | null;
}

async function findAccount(
	kind: string,
	value: string,
): Promise<TargetAccount | null> {
	const supabase = prodSupabase();
	let query = supabase
		.from("account")
		.select("id, email, spotify_id, display_name");

	if (kind === "account-id") query = query.eq("id", value);
	else if (kind === "spotify-id") query = query.eq("spotify_id", value);
	else query = query.ilike("email", escapeLikePattern(value.trim()));

	const { data, error } = await query.maybeSingle();
	if (error) throw new Error(`Account lookup failed: ${error.message}`);
	return (data as TargetAccount | null) ?? null;
}

async function countActiveLiked(accountId: string): Promise<number> {
	const supabase = prodSupabase();
	const { count, error } = await supabase
		.from("liked_song")
		.select("id", { count: "exact", head: true })
		.eq("account_id", accountId)
		.is("unliked_at", null);
	if (error) throw new Error(`Failed to count liked songs: ${error.message}`);
	return count ?? 0;
}

async function readExistingGrant(
	accountId: string,
): Promise<{ applied_at: string | null } | null> {
	const supabase = prodSupabase();
	const { data, error } = await supabase
		.from("account_liked_song_access_grant")
		.select("applied_at")
		.eq("account_id", accountId)
		.maybeSingle();
	if (error) throw new Error(`Failed to read existing grant: ${error.message}`);
	return (data as { applied_at: string | null } | null) ?? null;
}

interface GrantInput {
	accountId?: string;
	limit?: number | string;
	// Manual fallback when an account id isn't supplied by the picker.
	selectorKind?: string;
	selectorValue?: string;
	reason?: string;
	requestedBy?: string;
	dryRun?: boolean;
}

function resolveLimit(raw: number | string | undefined): number {
	const parsed =
		typeof raw === "string" ? Number.parseInt(raw, 10) : (raw ?? NaN);
	if (!Number.isFinite(parsed)) return DEFAULT_GRANT_LIMIT;
	return Math.min(Math.max(Math.trunc(parsed), MIN_GRANT_LIMIT), MAX_GRANT_LIMIT);
}

async function runGrantLikedAccess(
	input: GrantInput,
): Promise<OperationResult> {
	const accountId = (input.accountId ?? "").trim();
	const limit = resolveLimit(input.limit);

	// The picker yields an account id directly; the manual selector stays as a
	// fallback so an operator can still resolve by email / Spotify id if needed.
	let account: TargetAccount | null;
	if (accountId) {
		account = await findAccount("account-id", accountId);
	} else {
		const value = (input.selectorValue ?? "").trim();
		if (!value) throw new Error("Pick a user or provide a selector value.");
		account = await findAccount(input.selectorKind ?? "email", value);
	}
	if (!account) {
		return { ok: false, status: "not_found", message: "Account not found." };
	}

	const [existing, likedCount] = await Promise.all([
		readExistingGrant(account.id),
		countActiveLiked(account.id),
	]);

	const who = account.display_name || account.email || account.id;
	const base = {
		accountId: account.id,
		email: account.email,
		spotifyId: account.spotify_id,
		displayName: account.display_name,
		activeLikedSongs: likedCount,
		requestedLimit: limit,
	};

	if (input.dryRun) {
		let message: string;
		if (existing?.applied_at) {
			message = `Dry run: ${who} was already granted — nothing would change.`;
		} else if (likedCount === 0) {
			message = existing
				? `Dry run: pending row already exists; no active liked songs yet.`
				: `Dry run: would create a pending grant (no active liked songs yet).`;
		} else {
			message = `Dry run: would ${existing ? "apply the pending row" : "apply"} and unlock the top ${Math.min(likedCount, limit)} liked songs (cap ${limit}).`;
		}
		return { ok: true, status: "dry_run", message, details: base };
	}

	const grantResult = await grantLikedSongAccessForAccount(
		createAdminSupabaseClient(),
		{
			accountId: account.id,
			origin: "operator_manual",
			limit,
			requestedBy: input.requestedBy ?? null,
			note: input.reason ?? null,
		},
	);
	if (Result.isError(grantResult)) {
		throw new Error(`Grant failed: ${grantResult.error.message}`);
	}

	const payload = grantResult.value;
	let message: string;
	let details: Record<string, unknown> = base;
	if (payload.status === "applied") {
		const unlocked = payload.newlyUnlockedSongIds.length;
		message = `Applied for ${who} — ${payload.candidateCount} candidates, ${unlocked} newly unlocked. Enrichment queued (lightweight + full) for the new songs.`;
		details = {
			...base,
			candidateCount: payload.candidateCount,
			newlyUnlocked: unlocked,
		};
	} else if (payload.status === "already_applied") {
		message = `${who} was already granted — nothing changed.`;
	} else {
		message = `Pending created for ${who} — no active liked songs yet; the next sync applies it.`;
	}

	return { ok: true, status: payload.status, message, details };
}

export async function runOperation(
	id: string,
	input: Record<string, unknown>,
): Promise<OperationResult> {
	switch (id) {
		case "grant-liked-access":
			return runGrantLikedAccess(input as GrantInput);
		default:
			throw new Error(`Unknown operation: ${id}`);
	}
}
