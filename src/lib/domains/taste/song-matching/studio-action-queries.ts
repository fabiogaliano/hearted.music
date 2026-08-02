/**
 * Append-only Studio action log writes.
 *
 * The Studio log is collected now for future taste interpretation; it is not a
 * source for ranking or any current user-facing behavior.
 */

import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { Json, Tables, TablesInsert } from "@/lib/data/database.types";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import type { DbError } from "@/lib/shared/errors/database";
import { fromSupabaseMany } from "@/lib/shared/utils/result-wrappers/supabase";

export type StudioAction = Tables<"studio_action">;
export type StudioActionType = "add" | "pin" | "remove" | "dismiss";

export interface StudioActionContext {
	genrePills: string[];
	matchFilters: PlaylistMatchFiltersV1;
	intentPresent: boolean;
}

export interface StudioActionInsert {
	songId: string;
	sessionId: string;
	action: StudioActionType;
	position: number | null;
	context: StudioActionContext;
}

/** Inserts one or more Studio events without upserting or deduplicating them. */
export function insertStudioActions(
	accountId: string,
	actions: StudioActionInsert[],
): Promise<Result<StudioAction[], DbError>> {
	if (actions.length === 0) {
		return Promise.resolve(Result.ok<StudioAction[], DbError>([]));
	}

	const supabase = createAdminSupabaseClient();
	const rows: TablesInsert<"studio_action">[] = actions.map((action) => ({
		account_id: accountId,
		song_id: action.songId,
		session_id: action.sessionId,
		action: action.action,
		position: action.position,
		context: action.context as unknown as Json,
	}));

	return fromSupabaseMany(supabase.from("studio_action").insert(rows).select());
}
