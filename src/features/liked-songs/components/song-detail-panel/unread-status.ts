import type { SongDisplayState } from "@/lib/domains/billing/state";
import type { SongDetail } from "./song-detail-types";

// Why an unlocked song with no read has no content yet:
//   - analyzing   → genuinely in-flight: no settled fetch outcome yet, or the fetch
//                   found lyrics but the read hasn’t been generated yet.
//   - unavailable → lyrics-fetch has settled to a no-read outcome (not_found or
//                   instrumental without a read), or the analysis ran and produced no
//                   parseable output.
//
// Resolved-unknown fix: a song that cleanly resolves to "unknown" (retry candidate:
// lyrics fetch returned not_found, no song_analysis row written) used to show
// "Listening" forever because display_state stays ‘pending’ with no analysis row.
// contentFetchStatus = ‘not_found’ is the settled signal that breaks the loop.
//
// instrumental without a read: fetch settled to ‘instrumental’ but no analysis row
// parsed successfully — the read is unavailable, not in-flight.
//
// isEnrichmentRunning still matters for the genuinely in-flight case (e.g. a song
// just unlocked with no fetch outcome yet), but it is NOT allowed to override a
// settled fetch — a song whose fetch is done is not in-flight regardless of
// whether the pipeline is running for other songs.
export type UnreadStatus = "analyzing" | "unavailable";

export function unreadStatus({
	displayState,
	contentFetchStatus,
	isEnrichmentRunning = false,
}: {
	displayState?: SongDisplayState;
	contentFetchStatus?: SongDetail["contentFetchStatus"];
	isEnrichmentRunning?: boolean;
}): UnreadStatus {
	if (
		contentFetchStatus === "not_found" ||
		contentFetchStatus === "instrumental"
	) {
		return "unavailable";
	}
	const inFlight =
		isEnrichmentRunning ||
		displayState === "analyzing" ||
		displayState === "pending" ||
		contentFetchStatus === "lyrics";
	return inFlight ? "analyzing" : "unavailable";
}
