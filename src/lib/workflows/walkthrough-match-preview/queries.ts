/**
 * Walkthrough match preview persistence.
 *
 * Onboarding-only state. Deliberately NOT writing to match_snapshot or
 * match_result so the demo song's preview can score against target playlists
 * without polluting the production matching pipeline.
 */

import { Result } from "better-result";

import { createAdminSupabaseClient } from "@/lib/data/client";
import type { Json, Tables } from "@/lib/data/database.types";
import type { DbError } from "@/lib/shared/errors/database";
import {
	fromSupabaseMaybe,
	fromSupabaseSingle,
} from "@/lib/shared/utils/result-wrappers/supabase";

export type WalkthroughMatchPreview = Tables<"walkthrough_match_preview">;

/** Single playlist score returned by the walkthrough matcher. */
export interface WalkthroughPreviewMatch {
	readonly playlistId: string;
	readonly score: number;
	readonly factors: {
		readonly embedding: number;
		readonly audio: number;
		readonly genre: number;
	};
}

/**
 * Fingerprint over the inputs that determine the preview's content. If any of
 * these change we treat the persisted row as stale. Kept deliberately simple:
 * sorting playlist ids gives a deterministic key without requiring a content
 * hash, and "demo song changed" / "playlist set changed" are the only
 * invalidation triggers needed for v1.
 */
export function computePreviewFingerprint(
	demoSongId: string,
	targetPlaylistIds: readonly string[],
): string {
	const sorted = [...targetPlaylistIds].toSorted();
	return `${demoSongId}::${sorted.join(",")}`;
}

export function getWalkthroughPreview(
	accountId: string,
): Promise<Result<WalkthroughMatchPreview | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMaybe(
		supabase
			.from("walkthrough_match_preview")
			.select("*")
			.eq("account_id", accountId)
			.maybeSingle(),
	);
}

/**
 * Resets the preview row to `pending` for a fresh computation. Idempotent —
 * the unique key is `account_id`, so the same row is reused across demo-song
 * changes. Clears `matches` and `error` so a stale "ready" payload can never
 * leak through during the recompute window.
 */
export function upsertPendingPreview(args: {
	accountId: string;
	demoSongId: string;
	targetPlaylistIds: string[];
	fingerprint: string;
	jobId: string | null;
}): Promise<Result<WalkthroughMatchPreview, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseSingle(
		supabase
			.from("walkthrough_match_preview")
			.upsert(
				{
					account_id: args.accountId,
					demo_song_id: args.demoSongId,
					target_playlist_ids: args.targetPlaylistIds,
					fingerprint: args.fingerprint,
					status: "pending",
					matches: [],
					error: null,
					job_id: args.jobId,
				},
				{ onConflict: "account_id" },
			)
			.select()
			.single(),
	);
}

export function markPreviewReady(args: {
	accountId: string;
	fingerprint: string;
	matches: WalkthroughPreviewMatch[];
}): Promise<Result<WalkthroughMatchPreview, DbError>> {
	const supabase = createAdminSupabaseClient();
	const matchesJson: Json = args.matches.map((m) => ({
		playlistId: m.playlistId,
		score: m.score,
		factors: {
			embedding: m.factors.embedding,
			audio: m.factors.audio,
			genre: m.factors.genre,
		},
	}));
	return fromSupabaseSingle(
		supabase
			.from("walkthrough_match_preview")
			.update({
				status: "ready",
				matches: matchesJson,
				error: null,
			})
			.eq("account_id", args.accountId)
			// Guard against a late writer: if the user already changed inputs and
			// a newer pending row exists, we won't overwrite it with stale scores.
			.eq("fingerprint", args.fingerprint)
			.select()
			.single(),
	);
}

export function markPreviewFailed(args: {
	accountId: string;
	fingerprint: string;
	error: string;
}): Promise<Result<WalkthroughMatchPreview, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseSingle(
		supabase
			.from("walkthrough_match_preview")
			.update({
				status: "failed",
				error: args.error,
			})
			.eq("account_id", args.accountId)
			.eq("fingerprint", args.fingerprint)
			.select()
			.single(),
	);
}
