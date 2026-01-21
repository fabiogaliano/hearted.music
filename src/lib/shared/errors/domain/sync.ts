/**
 * Sync operation error types.
 */

import { TaggedError } from "better-result";
import { z } from "zod";

/** Sync operation types */
export const SyncTypeSchema = z.enum([
	"liked_songs",
	"playlists",
	"playlist_tracks",
]);
export type SyncType = z.infer<typeof SyncTypeSchema>;

/** Sync operation failed */
export class SyncFailedError extends TaggedError("SyncFailedError")<{
	syncType: SyncType;
	accountId: string;
	reason: string;
	message: string;
}>() {
	constructor(syncType: SyncType, accountId: string, reason: string) {
		super({
			syncType,
			accountId,
			reason,
			message: `${syncType} sync failed for account ${accountId}: ${reason}`,
		});
	}
}

/** All sync operation errors */
export type SyncError = SyncFailedError;
