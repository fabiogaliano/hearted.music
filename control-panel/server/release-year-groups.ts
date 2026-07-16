/**
 * Album-grouped release-year review — server actions for the control panel.
 *
 * The unresolved queue is ~5.9k songs but only ~4.7k distinct Spotify albums,
 * and a Spotify track's release year IS its album's release date — that's what
 * the auto-lookup would have written. So the operator's unit of work here is
 * the album, not the song: one confirmed year per group clears every year-less
 * track in it at once, and multi-song groups (600+ groups covering ~1.8k songs)
 * clear several songs per keystroke.
 *
 * Groups are ordered biggest-first by default so the highest-leverage entries
 * surface immediately; the queue's oldest/newest toggle breaks ties.
 *
 * Like the song-level module: list reads are read-only, the album set mutates
 * prod through db.tx, and callers wrap it in recordAction. External-candidate
 * lookups live in release-year-fetch; this module adds the permanent local
 * cache and the trickle pacing that respects iTunes' shared rate budget.
 */

import { read, tx } from "./db";
import { HttpError } from "./http-error";
import {
	getYearCandidates,
	putYearCandidates,
} from "./local-store/release-year-candidates";
import { getLocalStore, isLocalStoreReady } from "./local-store/store";
import { parseQueueQuery, type PageResult } from "./query-params";
import {
	fetchYearCandidates,
	type YearCandidate,
	type YearFetchQuery,
} from "./release-year-fetch";
import { FILTER_WHERE, validateReleaseYear } from "./release-year-reviews";

export interface ReleaseYearGroupSong {
	songId: string;
	songName: string;
	// Per-song context: on compilations the members differ by artist (and can
	// deserve different years), so a bare title isn't enough to judge them.
	artistLabel: string;
	imageUrl: string | null;
}

export interface ReleaseYearGroupRow {
	albumId: string;
	albumName: string | null;
	artistLabel: string;
	// Distinct primary artists in the group; > 1 marks a compilation, where the
	// single artistLabel shown is just one of many.
	artistCount: number;
	imageUrl: string | null;
	songCount: number;
	firstCreatedAt: string;
	songs: ReleaseYearGroupSong[];
}

export interface ReleaseYearGroupsPage extends PageResult<ReleaseYearGroupRow> {
	// Songs covered by the matching groups — the header speaks in songs while
	// paging speaks in groups.
	songTotal: number;
}

// Group-level search matches the whole group when ANY member matches (album,
// artist, or a song title the operator remembers), via bool_or in HAVING —
// a per-row predicate would silently drop the non-matching members of a
// matched group and mis-count "applies to N songs".
const GROUP_SEARCH_HAVING = (param: string) => `bool_or(
	s.album_name ilike ${param}
	or s.name ilike ${param}
	or array_to_string(s.artists, ', ') ilike ${param}
)`;

const GROUP_BASE_WHERE = `${FILTER_WHERE.unresolved} and s.album_id is not null`;

function escapeLike(value: string): string {
	return value.replace(/([\\%_])/g, "\\$1");
}

export async function releaseYearGroupsPage(
	url: URL,
): Promise<ReleaseYearGroupsPage> {
	const query = parseQueueQuery(url, "oldest");
	const params: unknown[] = [];
	let having = "";
	if (query.q) {
		params.push(`%${escapeLike(query.q)}%`);
		having = `having ${GROUP_SEARCH_HAVING(`$${params.length}`)}`;
	}

	const totals = await read<{ groups: string; songs: string }>(
		`select count(*)::text as groups, coalesce(sum(n), 0)::text as songs
		 from (
			select count(*) as n
			from public.song s
			where ${GROUP_BASE_WHERE}
			group by s.album_id
			${having}
		 ) g`,
		params,
	);
	const total = Number(totals[0]?.groups ?? 0);
	const songTotal = Number(totals[0]?.songs ?? 0);

	const dir = query.order === "newest" ? "desc" : "asc";
	const offset = (query.page - 1) * query.pageSize;
	const rowParams = [...params, query.pageSize, offset];
	const rows = await read(
		`select
			s.album_id,
			min(s.album_name) as album_name,
			min(array_to_string(s.artists, ', ')) as artist_label,
			count(distinct s.artists[1])::text as artist_count,
			min(s.image_url) as image_url,
			count(*)::text as song_count,
			min(s.created_at) as first_created_at,
			json_agg(json_build_object(
				'songId', s.id,
				'songName', s.name,
				'artistLabel', array_to_string(s.artists, ', '),
				'imageUrl', s.image_url
			) order by s.name) as songs
		 from public.song s
		 where ${GROUP_BASE_WHERE}
		 group by s.album_id
		 ${having}
		 order by count(*) desc, min(s.created_at) ${dir}, s.album_id asc
		 limit $${rowParams.length - 1} offset $${rowParams.length}`,
		rowParams,
	);

	return {
		rows: rows.map(mapGroupRow),
		total,
		songTotal,
		page: query.page,
		pageSize: query.pageSize,
	};
}

export function mapGroupRow(r: Record<string, unknown>): ReleaseYearGroupRow {
	// The type-less pooler driver returns json_agg as text; a typed driver would
	// hand back the array directly. Accept both.
	const rawSongs =
		typeof r.songs === "string" ? (JSON.parse(r.songs) as unknown) : r.songs;
	const songs = Array.isArray(rawSongs)
		? rawSongs.map((s) => {
				const song = s as Record<string, unknown>;
				return {
					songId: String(song.songId),
					songName: String(song.songName ?? ""),
					artistLabel:
						song.artistLabel == null ? "" : String(song.artistLabel),
					imageUrl: song.imageUrl == null ? null : String(song.imageUrl),
				};
			})
		: [];
	return {
		albumId: String(r.album_id),
		albumName: r.album_name == null ? null : String(r.album_name),
		artistLabel: r.artist_label == null ? "" : String(r.artist_label),
		artistCount: Number(r.artist_count ?? 1),
		imageUrl: r.image_url == null ? null : String(r.image_url),
		songCount: Number(r.song_count ?? songs.length),
		firstCreatedAt: String(r.first_created_at),
		songs,
	};
}

export interface SetAlbumYearResult {
	ok: true;
	albumId: string;
	releaseYear: number;
	songCount: number;
	albumName: string | null;
}

// Spotify album ids are 22-char base62; stay a little loose but reject anything
// that could smuggle SQL-adjacent garbage into logs and history rows.
const ALBUM_ID_RE = /^[A-Za-z0-9]{10,40}$/;

export function validateAlbumId(albumId: string): string {
	if (!ALBUM_ID_RE.test(albumId)) {
		throw new HttpError(400, "Invalid album id.");
	}
	return albumId;
}

/**
 * Write one year to every still-year-less song of an album. Only null years are
 * touched: a member that already got a year from another path keeps it. There
 * is no revert — every affected song had null before, and the preservation
 * trigger blocks restoring null (same rule as a first-time single-song set).
 */
export async function setReleaseYearForAlbum(
	albumId: string,
	yearInput: unknown,
): Promise<SetAlbumYearResult> {
	validateAlbumId(albumId);
	const year = validateReleaseYear(yearInput);
	const outcome = await tx(async (run) => {
		const rows = await run<{ id: string; album_name: string | null }>(
			`select id, album_name from public.song
			 where album_id = $1 and release_year is null
			 for update`,
			[albumId],
		);
		if (rows.length === 0) {
			throw new HttpError(404, "No year-less songs found for that album.");
		}
		await run(
			`update public.song
			 set release_year = $2, updated_at = now()
			 where album_id = $1 and release_year is null`,
			[albumId, year],
		);
		return {
			songCount: rows.length,
			albumName: rows[0]?.album_name ?? null,
		};
	});
	return { ok: true, albumId, releaseYear: year, ...outcome };
}

export interface AlbumCandidatesEntry {
	fetchedAt: string;
	candidates: YearCandidate[];
}

export interface AlbumCandidatesResult {
	candidates: Record<string, AlbumCandidatesEntry>;
	// Albums this call didn't get to (per-call fetch cap, or an upstream error
	// made continuing pointless). The client may re-request them later.
	remaining: string[];
	// True when an upstream failure stopped the sweep — the client should stop
	// auto-chaining and let the operator retry deliberately.
	throttled: boolean;
}

// One call fetches at most this many uncached albums, spaced apart, so a fresh
// 100-row page trickles in over a few chained requests instead of bursting past
// iTunes' ~20/min tolerance in one go.
const MAX_FETCH_PER_CALL = 15;
const FETCH_SPACING_MS = 350;
const MAX_ALBUM_IDS = 200;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface AlbumMetaRow {
	album_id: string;
	album_name: string | null;
	artist_label: string | null;
	artist_count: string | number;
}

function queryForMeta(meta: AlbumMetaRow): YearFetchQuery {
	const artistLabel = meta.artist_label ?? "";
	const primaryArtist = artistLabel.split(",")[0]?.trim() ?? "";
	// Compilations have no single artist; searching "album name" alone matches
	// better than polluting the term with one arbitrary member artist.
	const isCompilation = Number(meta.artist_count ?? 1) > 1;
	return {
		albumName: meta.album_name ?? "",
		artistName: isCompilation ? "" : primaryArtist,
	};
}

export async function yearCandidatesForAlbums(
	albumIdsInput: unknown,
	fetchImpl: typeof fetch = fetch,
): Promise<AlbumCandidatesResult> {
	if (!Array.isArray(albumIdsInput) || albumIdsInput.length === 0) {
		throw new HttpError(400, "albumIds is required.");
	}
	if (albumIdsInput.length > MAX_ALBUM_IDS) {
		throw new HttpError(400, `At most ${MAX_ALBUM_IDS} albums per request.`);
	}
	const albumIds = albumIdsInput.map((id) => validateAlbumId(String(id)));

	const result: Record<string, AlbumCandidatesEntry> = {};
	// Candidate lookups are reads, so unlike mutations they still work when the
	// local store failed to open — they just lose caching for the session.
	const store = isLocalStoreReady() ? getLocalStore() : null;
	const uncached: string[] = [];
	if (store) {
		const cached = getYearCandidates(store, albumIds);
		for (const albumId of albumIds) {
			const hit = cached.get(albumId);
			if (hit) {
				result[albumId] = {
					fetchedAt: hit.fetchedAt,
					candidates: JSON.parse(hit.candidatesJson) as YearCandidate[],
				};
			} else {
				uncached.push(albumId);
			}
		}
	} else {
		uncached.push(...albumIds);
	}

	const toFetch = uncached.slice(0, MAX_FETCH_PER_CALL);
	let remaining = uncached.slice(MAX_FETCH_PER_CALL);
	let throttled = false;

	if (toFetch.length > 0) {
		// string_to_array over a joined param: the type-less pooler driver can't
		// bind a JS array as text[], and validateAlbumId already guarantees the
		// ids are comma-free base62.
		const metaRows = await read<AlbumMetaRow>(
			`select
				s.album_id,
				min(s.album_name) as album_name,
				min(array_to_string(s.artists, ', ')) as artist_label,
				count(distinct s.artists[1])::text as artist_count
			 from public.song s
			 where s.album_id = any(string_to_array($1, ','))
			 group by s.album_id`,
			[toFetch.join(",")],
		);
		const metaByAlbum = new Map(metaRows.map((m) => [String(m.album_id), m]));

		for (let i = 0; i < toFetch.length; i++) {
			const albumId = toFetch[i]!;
			const meta = metaByAlbum.get(albumId);
			if (!meta) continue;
			try {
				if (i > 0) await sleep(FETCH_SPACING_MS);
				const candidates = await fetchYearCandidates(
					queryForMeta(meta),
					fetchImpl,
				);
				const entry: AlbumCandidatesEntry = {
					fetchedAt: new Date().toISOString(),
					candidates,
				};
				result[albumId] = entry;
				// Hits and misses both cache: re-asking iTunes about an album it
				// doesn't have burns the same rate budget as a hit.
				if (store) {
					putYearCandidates(
						store,
						albumId,
						entry.fetchedAt,
						JSON.stringify(candidates),
					);
				}
			} catch {
				// Upstream is failing (likely throttling) — stop the sweep here and
				// hand the rest back instead of hammering through the whole list.
				remaining = [albumId, ...toFetch.slice(i + 1), ...remaining];
				throttled = true;
				break;
			}
		}
	}

	return { candidates: result, remaining, throttled };
}
