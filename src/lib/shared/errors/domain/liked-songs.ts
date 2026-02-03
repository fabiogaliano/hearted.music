/**
 * Liked Songs Domain Errors - Errors for liked songs operations.
 *
 * These errors cover page loading, song lookups, album art fetching,
 * and playlist operations within the liked songs domain.
 */

import { TaggedError } from "better-result";

/**
 * Error loading liked songs page data.
 */
export class LikedSongsLoadError extends TaggedError("LikedSongsLoadError")<{
	source: string;
	reason: string;
	message: string;
}>() {
	constructor(source: string, reason: string) {
		super({
			source,
			reason,
			message: `Failed to load liked songs from ${source}: ${reason}`,
		});
	}
}

/**
 * Song not found in collection.
 */
export class SongNotFoundError extends TaggedError("SongNotFoundError")<{
	songId: string;
	context?: string;
	message: string;
}>() {
	constructor(songId: string, context?: string) {
		super({
			songId,
			context,
			message: context
				? `Song ${songId} not found in ${context}`
				: `Song ${songId} not found`,
		});
	}
}

/**
 * Error fetching album art images in batch.
 */
export class AlbumArtBatchError extends TaggedError("AlbumArtBatchError")<{
	failedCount: number;
	totalCount: number;
	reason: string;
	message: string;
}>() {
	constructor(failedCount: number, totalCount: number, reason: string) {
		super({
			failedCount,
			totalCount,
			reason,
			message: `Album art batch fetch failed: ${failedCount}/${totalCount} images - ${reason}`,
		});
	}
}

/**
 * Error adding songs to playlist.
 */
export class PlaylistAddError extends TaggedError("PlaylistAddError")<{
	playlistId: string;
	songIds: string[];
	reason: string;
	message: string;
}>() {
	constructor(playlistId: string, songIds: string[], reason: string) {
		super({
			playlistId,
			songIds,
			reason,
			message: `Failed to add ${songIds.length} song(s) to playlist ${playlistId}: ${reason}`,
		});
	}
}

/**
 * Union of all liked songs errors.
 */
export type LikedSongsError =
	| LikedSongsLoadError
	| SongNotFoundError
	| AlbumArtBatchError
	| PlaylistAddError;
