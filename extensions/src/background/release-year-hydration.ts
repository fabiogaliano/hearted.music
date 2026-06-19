import { mapWithConcurrency } from "../../../src/lib/shared/utils/concurrency";
import { getTrack } from "../shared/spotify-client/reads";
import type { SpotifyTrackDTO } from "../shared/types";

/**
 * Runtime release-year hydration for liked songs.
 *
 * The bulk fetchLibraryTracks query carries no album date, so liked songs arrive
 * without a release year. getTrack DOES carry it, so we fill the gap with a few
 * targeted getTrack calls per sync rather than the old one-off backfill script.
 *
 * Dedupe is DB-authoritative, NOT browser-local: the backend (song.release_year
 * + song.release_year_checked_at) is the source of truth for which liked songs
 * still need a lookup. We ask /release-year/pending which ids to fetch and post
 * the results to /release-year/checked, so coverage converges across devices and
 * survives a storage reset / reinstall — the old attempted-id set in
 * browser.storage.local re-fetched everything whenever that storage was lost.
 *
 * Kept narrow and self-terminating: a per-sync BUDGET caps how many getTrack
 * calls a single sync makes (so the first sync of a large library can't fire
 * thousands of requests), and the backend marks every checked id so it's never
 * re-queried. Best-effort throughout: any failure leaves the sync unaffected.
 */

const GET_TRACK_CONCURRENCY = 2;
const HYDRATION_BUDGET = 200;
const NO_EXCLUDED_TRACK_IDS: ReadonlySet<string> = new Set();

/** Reads a track's release year; structurally satisfied by reads.getTrack. */
export type ReleaseYearReader = (
	token: string,
	trackUri: string,
) => Promise<{ releaseYear: number | null }>;

/** Backend POST helper; structurally satisfied by the service worker's postToBackend. */
export type PostToBackend = (
	path: string,
	body: Record<string, unknown>,
) => Promise<Response>;

/** A completed lookup: the resolved year, or null when Spotify had no usable one. */
export interface ReleaseYearLookup {
	spotifyId: string;
	releaseYear: number | null;
}

export interface ReleaseYearHydrationResult {
	likedSongs: SpotifyTrackDTO[];
	/** Lookups to finalize via recordReleaseYearLookups *after* a successful sync. */
	lookups: ReleaseYearLookup[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/**
 * Liked songs still missing a year locally and not already covered by a playlist
 * track carrying a year this sync. This is the candidate pool the backend then
 * narrows to the ids that genuinely still need a lookup. Liked songs arrive
 * newest-first, so genuine new likes sit ahead of the older backlog.
 */
export function selectLikedTracksMissingReleaseYear(
	likedSongs: SpotifyTrackDTO[],
	excludedTrackIds: ReadonlySet<string> = NO_EXCLUDED_TRACK_IDS,
): SpotifyTrackDTO[] {
	return likedSongs.filter(
		(song) =>
			song.track.release_year == null && !excludedTrackIds.has(song.track.id),
	);
}

/**
 * Asks the backend which of the given liked-song ids still need a release-year
 * lookup (DB-authoritative: not yet resolved and not yet checked). Best-effort —
 * on any failure returns an empty set so this sync simply skips hydration rather
 * than falling back to a local guess that would re-fetch already-checked songs.
 */
export async function fetchIdsNeedingLookup(
	postToBackend: PostToBackend,
	spotifyIds: string[],
): Promise<Set<string>> {
	if (spotifyIds.length === 0) return new Set();

	try {
		const response = await postToBackend(
			"/api/extension/release-year/pending",
			{ spotifyIds },
		);
		if (!response.ok) {
			console.warn(
				`[hearted.] Release-year pending check failed with HTTP ${response.status}; skipping hydration this sync`,
			);
			return new Set();
		}

		const body: unknown = await response.json();
		if (!isRecord(body) || !Array.isArray(body.needsLookup)) {
			console.warn(
				"[hearted.] Release-year pending check returned invalid payload",
			);
			return new Set();
		}
		return new Set(
			body.needsLookup.filter((id): id is string => typeof id === "string"),
		);
	} catch (err) {
		console.warn("[hearted.] Release-year pending check failed:", err);
		return new Set();
	}
}

/**
 * Resolves release years for the given tracks via getTrack. Returns the resolved
 * years and the completed lookups (every id we got a response for, year or null)
 * — the latter is what callers post to /release-year/checked so the backend
 * stamps them as checked. Transient failures are omitted so a later sync retries.
 */
export async function fetchReleaseYears(
	token: string,
	tracks: SpotifyTrackDTO[],
	reader: ReleaseYearReader = getTrack,
	concurrency: number = GET_TRACK_CONCURRENCY,
): Promise<{ resolved: Map<string, number>; lookups: ReleaseYearLookup[] }> {
	const resolved = new Map<string, number>();
	const lookups: ReleaseYearLookup[] = [];

	await mapWithConcurrency(tracks, concurrency, async (song) => {
		try {
			const { releaseYear } = await reader(token, song.track.uri);
			lookups.push({ spotifyId: song.track.id, releaseYear });
			if (releaseYear != null) {
				resolved.set(song.track.id, releaseYear);
			}
		} catch (err) {
			// Transient: omit from lookups so a later sync retries this track.
			console.warn(
				`[hearted.] Release-year getTrack failed for ${song.track.id}:`,
				err,
			);
		}
	});

	return { resolved, lookups };
}

/** Immutably writes resolved years back onto the matching liked songs. */
export function attachReleaseYearsToTracks(
	tracks: SpotifyTrackDTO[],
	resolved: ReadonlyMap<string, number>,
): SpotifyTrackDTO[] {
	if (resolved.size === 0) return tracks;
	return tracks.map((song) => {
		const year = resolved.get(song.track.id);
		if (year == null) return song;
		return { ...song, track: { ...song.track, release_year: year } };
	});
}

/** Marks tracks whose liked-song release-year lookup completed this sync. */
export function markReleaseYearCheckedOnTracks(
	tracks: SpotifyTrackDTO[],
	lookups: ReadonlyArray<ReleaseYearLookup>,
): SpotifyTrackDTO[] {
	if (lookups.length === 0) return tracks;
	const checkedIds = new Set(lookups.map((lookup) => lookup.spotifyId));
	return tracks.map((song) =>
		checkedIds.has(song.track.id)
			? {
					...song,
					track: { ...song.track, release_year_checked: true },
				}
			: song,
	);
}

/**
 * Posts completed lookups to the backend so each checked song is durably stamped
 * (release_year filled where found, release_year_checked_at set regardless). Call
 * this only *after* a successful sync upload: if it never runs, nothing is
 * finalized and the next sync simply re-selects the same songs.
 */
export async function recordReleaseYearLookups(
	postToBackend: PostToBackend,
	lookups: ReleaseYearLookup[],
): Promise<void> {
	if (lookups.length === 0) return;
	const response = await postToBackend("/api/extension/release-year/checked", {
		lookups,
	});
	if (response.ok) return;

	const errorText = await response.text().catch(() => "");
	throw new Error(
		`Release-year lookup persistence failed: HTTP ${response.status}${errorText ? ` ${errorText}` : ""}`,
	);
}

/**
 * Hydrates liked songs' release years for this sync and returns the (possibly
 * updated) list plus the lookups to finalize *after* a successful sync upload.
 * Best-effort: on any failure it returns the input unchanged so a hydration
 * problem never breaks the sync.
 */
export async function hydrateLikedSongReleaseYears(
	token: string,
	likedSongs: SpotifyTrackDTO[],
	excludedTrackIds: ReadonlySet<string> = NO_EXCLUDED_TRACK_IDS,
	postToBackend?: PostToBackend,
): Promise<ReleaseYearHydrationResult> {
	if (!postToBackend) return { likedSongs, lookups: [] };

	try {
		const missing = selectLikedTracksMissingReleaseYear(
			likedSongs,
			excludedTrackIds,
		);
		if (missing.length === 0) return { likedSongs, lookups: [] };

		const needsLookup = await fetchIdsNeedingLookup(
			postToBackend,
			missing.map((song) => song.track.id),
		);
		const candidates = missing
			.filter((song) => needsLookup.has(song.track.id))
			.slice(0, HYDRATION_BUDGET);
		if (candidates.length === 0) return { likedSongs, lookups: [] };

		console.log(
			`[hearted.] Hydrating release year for ${candidates.length} liked song(s) via getTrack`,
		);
		const { resolved, lookups } = await fetchReleaseYears(token, candidates);

		console.log(
			`[hearted.] Release-year hydration resolved ${resolved.size}/${candidates.length}`,
		);
		const hydrated = markReleaseYearCheckedOnTracks(
			attachReleaseYearsToTracks(likedSongs, resolved),
			lookups,
		);
		return {
			likedSongs: hydrated,
			lookups,
		};
	} catch (err) {
		console.warn("[hearted.] Release-year hydration failed:", err);
		return { likedSongs, lookups: [] };
	}
}
