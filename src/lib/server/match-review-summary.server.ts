/**
 * Queue-aware match review summary (dashboard CTA, sidebar badge, empty
 * state). Server-only: it reads the DB directly, so it lives outside the
 * client-reachable match-review-queue.functions module, whose server fns call
 * it only inside their handlers.
 */

import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { getPreferredMatchViewMode } from "@/lib/domains/library/accounts/preferences-queries";
import {
	getOrderedUndecidedPlaylistIds,
	getOrderedUndecidedSongIds,
	getQueueSummary,
} from "@/lib/domains/taste/match-review-queue/service";
import type { MatchOrientation } from "@/lib/domains/taste/match-review-queue/types";
import { getLatestMatchSnapshot } from "@/lib/domains/taste/song-matching/queries";
import { captureServerError } from "@/lib/observability/capture-server-error";

export interface ServerMatchReviewSummaryResult {
	pendingCount: number;
	previewImages: Array<{
		id: number;
		image: string;
		name: string;
		artist: string;
	}>;
	hasActiveQueue: boolean;
	/** Which orientation this summary reflects — used by the sidebar/dashboard to
	 *  build the correct Match link (/match vs /match?mode=song). */
	orientation: MatchOrientation;
}

function reportQueueError(
	error: unknown,
	operation: string,
	context: { accountId: string; orientation: MatchOrientation },
): void {
	captureServerError(error, {
		area: "match_review_queue",
		operation,
		accountId: context.accountId,
		extra: { orientation: context.orientation },
	});
}

/**
 * Resolves the queue-aware match review summary for a specific orientation.
 *
 * Active-queue path: asks the domain for the pending count and top-3 subject ids
 * (songs in song mode, playlists in playlist mode), then maps them → preview rows.
 *
 * Snapshot-fallback path (no active queue): derives count and preview ids from
 * the latest snapshot using the orientation's ordering authority
 * (getOrderedUndecidedSongIds / getOrderedUndecidedPlaylistIds) — the same
 * derivation the /match walk uses — without creating a queue. Queue creation
 * happens only on /match entry via startOrResumeMatchDeck.
 *
 * dashboard.functions.ts calls it once and shares the result across both the
 * CTA count and the preview fan.
 */
export async function resolveMatchReviewSummary(
	accountId: string,
	orientation: MatchOrientation,
): Promise<ServerMatchReviewSummaryResult> {
	const summaryResult = await getQueueSummary(accountId, orientation);

	if (Result.isError(summaryResult)) {
		// The dashboard still degrades to the snapshot-fallback path below, but a DB
		// failure here is operational (Result.ok carries the no-active-queue case),
		// so capture it — otherwise a persistently blank summary looks like "caught
		// up" with no server-side trace.
		reportQueueError(summaryResult.error, "resolve_match_review_summary", {
			accountId,
			orientation,
		});
	}

	const empty: ServerMatchReviewSummaryResult = {
		pendingCount: 0,
		previewImages: [],
		hasActiveQueue: false,
		orientation,
	};

	let topIds: string[];
	let pendingCount: number;
	let hasActiveQueue: boolean;

	if (Result.isOk(summaryResult) && summaryResult.value.hasActiveQueue) {
		const summary = summaryResult.value;
		pendingCount = summary.pendingCount;
		hasActiveQueue = true;
		topIds = summary.previewSubjectIds.slice(0, 3);
	} else {
		// No active queue — fall back to the latest-snapshot ordering authority so
		// the dashboard previews stay identical to the pre-queue behaviour. We do
		// NOT create a queue here; that is deferred to /match entry.
		hasActiveQueue = false;
		const snapshotResult = await getLatestMatchSnapshot(accountId);
		if (Result.isError(snapshotResult)) {
			// DB failure reading the latest snapshot — capture before degrading to
			// empty (a null value is the normal "no snapshot yet" case, not captured).
			reportQueueError(snapshotResult.error, "resolve_match_review_summary", {
				accountId,
				orientation,
			});
			return empty;
		}
		if (!snapshotResult.value) return empty;

		if (orientation === "playlist") {
			const playlistIdsResult = await getOrderedUndecidedPlaylistIds(
				snapshotResult.value.id,
				accountId,
			);
			// A transient failure surfaces as an empty summary rather than crashing
			// the dashboard; the next refetch recovers — but capture it so the blank
			// is diagnosable.
			if (Result.isError(playlistIdsResult)) {
				reportQueueError(
					playlistIdsResult.error,
					"resolve_match_review_summary",
					{ accountId, orientation },
				);
				return empty;
			}
			pendingCount = playlistIdsResult.value.playlistIds.length;
			topIds = playlistIdsResult.value.playlistIds.slice(0, 3);
		} else {
			const songIdsResult = await getOrderedUndecidedSongIds(
				snapshotResult.value.id,
				accountId,
			);
			// A transient failure surfaces as an empty summary rather than crashing
			// the dashboard; the next refetch recovers — but capture it so the blank
			// is diagnosable.
			if (Result.isError(songIdsResult)) {
				reportQueueError(songIdsResult.error, "resolve_match_review_summary", {
					accountId,
					orientation,
				});
				return empty;
			}
			pendingCount = songIdsResult.value.songIds.length;
			topIds = songIdsResult.value.songIds.slice(0, 3);
		}
	}

	if (topIds.length === 0) {
		return { pendingCount, previewImages: [], hasActiveQueue, orientation };
	}

	const previewImages =
		orientation === "playlist"
			? await resolvePlaylistPreviews(topIds)
			: await resolveSongPreviews(topIds);

	return { pendingCount, previewImages, hasActiveQueue, orientation };
}

/**
 * Maps song subject IDs to preview entries (image + name + artist), preserving
 * the input order. Songs without an image are dropped so the fan never shows a
 * broken tile.
 */
async function resolveSongPreviews(
	topIds: string[],
): Promise<ServerMatchReviewSummaryResult["previewImages"]> {
	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase
		.from("song")
		.select("id, image_url, name, artists")
		.in("id", topIds);

	if (error || !data) return [];

	const songMap = new Map(data.map((s) => [s.id, s]));
	return topIds
		.map((id, i) => {
			const song = songMap.get(id);
			return song?.image_url
				? {
						id: i + 1,
						image: song.image_url,
						name: song.name,
						artist: song.artists[0] ?? "Unknown Artist",
					}
				: null;
		})
		.filter(
			(p): p is ServerMatchReviewSummaryResult["previewImages"][number] =>
				p !== null,
		);
}

/**
 * Playlist counterpart to resolveSongPreviews: maps playlist subject IDs to
 * preview entries. Playlists have no artist, so that field is empty (the dashboard
 * preview tile renders name + image only). Playlists without an image are dropped.
 */
async function resolvePlaylistPreviews(
	topIds: string[],
): Promise<ServerMatchReviewSummaryResult["previewImages"]> {
	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase
		.from("playlist")
		.select("id, image_url, name")
		.in("id", topIds);

	if (error || !data) return [];

	const playlistMap = new Map(data.map((p) => [p.id, p]));
	return topIds
		.map((id, i) => {
			const playlist = playlistMap.get(id);
			return playlist?.image_url
				? {
						id: i + 1,
						image: playlist.image_url,
						name: playlist.name,
						artist: "",
					}
				: null;
		})
		.filter(
			(p): p is ServerMatchReviewSummaryResult["previewImages"][number] =>
				p !== null,
		);
}

/**
 * Reads the account's stored match_view_mode preference and delegates to
 * resolveMatchReviewSummary with that orientation. Falls back to 'song' when the
 * preference row is missing or unreadable. Used by dashboard + sidebar so those
 * surfaces always reflect the user's last-selected mode without needing the mode
 * passed explicitly from the client.
 */
export async function resolvePreferredMatchReviewSummary(
	accountId: string,
): Promise<ServerMatchReviewSummaryResult> {
	const mode = await getPreferredMatchViewMode(accountId);
	return resolveMatchReviewSummary(accountId, mode);
}
