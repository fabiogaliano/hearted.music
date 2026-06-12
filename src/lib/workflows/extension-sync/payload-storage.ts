/**
 * Storage staging for extension sync payloads.
 *
 * The CF Worker ingress streams the raw ~20 MB body to a private Storage object
 * (no parse, ~0 CPU); the Bun worker downloads + validates it, then deletes it
 * on terminal settlement. Storage's confirmed 50 MB/file limit comfortably
 * covers the 20 MB body cap, and keeps the blob out of the 500 MB Free-plan DB.
 *
 * All access is via the service-role admin client, which bypasses the (absent)
 * Storage RLS on the policy-less `sync-payloads` bucket.
 */

import { Result } from "better-result";
import type { AdminSupabaseClient } from "@/lib/data/client";
import { DatabaseError, type DbError } from "@/lib/shared/errors/database";

export const SYNC_PAYLOADS_BUCKET = "sync-payloads";

/**
 * Object key for a staged payload: `{accountId}/{uuid}.json`. Namespacing by
 * account keeps the orphan sweep and any future per-account cleanup trivial.
 */
export function buildSyncPayloadPath(accountId: string): string {
	return `${accountId}/${crypto.randomUUID()}.json`;
}

export async function uploadSyncPayload(
	supabase: AdminSupabaseClient,
	path: string,
	body: string | Uint8Array | ArrayBuffer,
): Promise<Result<void, DbError>> {
	const { error } = await supabase.storage
		.from(SYNC_PAYLOADS_BUCKET)
		.upload(path, body, {
			contentType: "application/json",
			upsert: false,
		});

	if (error) {
		return Result.err(
			new DatabaseError({
				code: "storage_upload_failed",
				message: error.message,
			}),
		);
	}

	return Result.ok(undefined);
}

export async function downloadSyncPayload(
	supabase: AdminSupabaseClient,
	path: string,
): Promise<Result<string, DbError>> {
	const { data, error } = await supabase.storage
		.from(SYNC_PAYLOADS_BUCKET)
		.download(path);

	if (error) {
		return Result.err(
			new DatabaseError({
				code: "storage_download_failed",
				message: error.message,
			}),
		);
	}

	if (!data) {
		return Result.err(
			new DatabaseError({
				code: "storage_download_empty",
				message: `No payload at ${path}`,
			}),
		);
	}

	return Result.ok(await data.text());
}

/**
 * Best-effort delete. Payloads are reproducible by re-syncing, so a failed
 * delete is logged by the caller, not fatal — the orphan sweep is the backstop.
 */
export async function deleteSyncPayload(
	supabase: AdminSupabaseClient,
	path: string,
): Promise<Result<void, DbError>> {
	const { error } = await supabase.storage
		.from(SYNC_PAYLOADS_BUCKET)
		.remove([path]);

	if (error) {
		return Result.err(
			new DatabaseError({
				code: "storage_delete_failed",
				message: error.message,
			}),
		);
	}

	return Result.ok(undefined);
}
