/**
 * Backfill artist.gender from MusicBrainz.
 *
 * Resolves each Spotify artist id to a MusicBrainz artist via the
 * open.spotify.com URL relationship, then reads the artist's gender. Both calls
 * are rate-limited to MusicBrainz's 1 req/s/IP ceiling, so this is a slow
 * background job (~1 artist / 2s for solo artists, faster for groups/unlinked).
 *
 *   gender   = MusicBrainz identity gender (Person entities only) — a PRIOR for
 *              vocal-gender matching, NOT vocal gender. Groups return null.
 *   coverage = probe (n=180): 82% linked, 59% gendered Person.
 *
 * Idempotent + resumable: every processed artist gets musicbrainz_checked_at set
 * (regardless of outcome), and the job only ever pulls rows where it is null. A
 * crash re-resolves at most one unflushed batch.
 *
 * Writes go through the prod SQL tool (scripts/db/prod.ts) so prod access stays
 * in one place. Reads/writes target PRODUCTION.
 *
 * Usage:
 *   bun run scripts/maintenance/backfill-artist-gender.ts            # full run
 *   bun run scripts/maintenance/backfill-artist-gender.ts --limit 30 # smoke test
 *   bun run scripts/maintenance/backfill-artist-gender.ts --dry-run  # no prod writes
 */

import { resolve } from "node:path";

const REPO_ROOT = process.cwd();
const PROD_TOOL = resolve(REPO_ROOT, "scripts/db/prod.ts");

// MusicBrainz requires a descriptive User-Agent with contact info, and throttles
// per IP to 1 req/s. Stay just under it.
const USER_AGENT = "HeartedEnrichment/1.0 ( fbkzdev@gmail.com )";
const RATE_MS = 1100;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const limitArg = readArg("--limit");
const batchSize = Number(readArg("--batch") ?? "50");
const LIMIT = limitArg ? Number(limitArg) : null;

function readArg(flag: string): string | null {
	const i = args.indexOf(flag);
	return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Artist {
	spotify_id: string;
	name: string;
}
interface Resolved {
	spotify_id: string;
	mbid: string | null;
	gender: "male" | "female" | "other" | null;
}

/** Run scripts/db/prod.ts directly (not via `bun run`, to keep stdout clean). */
async function prodSql(sql: string, opts: { write?: boolean } = {}): Promise<unknown> {
	const argv = [
		PROD_TOOL,
		"sql",
		...(opts.write ? ["--write", "--yes"] : []),
		"--json",
		sql,
	];
	const proc = Bun.spawn(["bun", ...argv], {
		cwd: REPO_ROOT,
		stdout: "pipe",
		stderr: "inherit",
	});
	const out = await new Response(proc.stdout).text();
	const code = await proc.exited;
	if (code !== 0) throw new Error(`prod:sql exited ${code}`);
	const trimmed = out.trim();
	return trimmed ? JSON.parse(trimmed) : [];
}

function normalizeGender(raw: string | null | undefined): Resolved["gender"] {
	switch ((raw ?? "").toLowerCase()) {
		case "male":
			return "male";
		case "female":
			return "female";
		case "other":
			return "other";
		default:
			// "Not applicable" / unset / unexpected — record the link but no gender.
			return null;
	}
}

async function mbFetch(url: string): Promise<Response> {
	for (let attempt = 0; ; attempt++) {
		const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
		// 503 = rate limit exceeded; back off and retry a few times.
		if (res.status === 503 && attempt < 4) {
			await sleep(RATE_MS * (attempt + 2));
			continue;
		}
		return res;
	}
}

/** Spotify id -> MusicBrainz MBID + normalized gender (null when not derivable). */
async function resolveArtist(spotifyId: string): Promise<Resolved> {
	const urlEndpoint =
		"https://musicbrainz.org/ws/2/url?resource=" +
		encodeURIComponent(`https://open.spotify.com/artist/${spotifyId}`) +
		"&inc=artist-rels&fmt=json";

	const urlRes = await mbFetch(urlEndpoint);
	await sleep(RATE_MS);
	if (urlRes.status === 404) return { spotify_id: spotifyId, mbid: null, gender: null };
	if (!urlRes.ok) throw new Error(`MB url lookup ${urlRes.status} for ${spotifyId}`);

	const urlData = (await urlRes.json()) as {
		relations?: Array<{
			"target-type"?: string;
			artist?: { id: string; type?: string };
		}>;
	};
	const rel = (urlData.relations ?? []).find((r) => r["target-type"] === "artist");
	if (!rel?.artist) return { spotify_id: spotifyId, mbid: null, gender: null };

	const { id: mbid, type } = rel.artist;
	// Only Person entities carry a gender; skip the second call for groups/others.
	if (type !== "Person") return { spotify_id: spotifyId, mbid, gender: null };

	const artistRes = await mbFetch(`https://musicbrainz.org/ws/2/artist/${mbid}?fmt=json`);
	await sleep(RATE_MS);
	if (!artistRes.ok) throw new Error(`MB artist lookup ${artistRes.status} for ${mbid}`);
	const artistData = (await artistRes.json()) as { gender?: string | null };
	return { spotify_id: spotifyId, mbid, gender: normalizeGender(artistData.gender) };
}

function lit(v: string | null): string {
	return v === null ? "null::text" : `'${v.replace(/'/g, "''")}'::text`;
}

/** Batch-update prod: set gender/mbid/checked_at for every resolved artist. */
async function flush(rows: Resolved[]): Promise<void> {
	if (rows.length === 0) return;
	const values = rows
		.map((r) => `(${lit(r.spotify_id)}, ${lit(r.gender)}, ${lit(r.mbid)})`)
		.join(",\n");
	const sql = `
		update artist as a set
			gender = v.gender,
			musicbrainz_id = v.musicbrainz_id,
			musicbrainz_checked_at = now()
		from (values
			${values}
		) as v(spotify_id, gender, musicbrainz_id)
		where a.spotify_id = v.spotify_id;`;

	if (dryRun) {
		console.log(`  [dry-run] would flush ${rows.length} rows`);
		return;
	}
	for (let attempt = 0; ; attempt++) {
		try {
			await prodSql(sql, { write: true });
			return;
		} catch (err) {
			if (attempt >= 2) throw err;
			console.error(`  flush failed (attempt ${attempt + 1}), retrying…`, err);
			await sleep(2000);
		}
	}
}

async function main() {
	const pending = (await prodSql(
		`select spotify_id, name from artist where musicbrainz_checked_at is null order by spotify_id${
			LIMIT ? ` limit ${LIMIT}` : ""
		}`,
	)) as Artist[];

	console.log(
		`Backfilling ${pending.length} artist(s)${dryRun ? " [DRY RUN]" : ""}, batch=${batchSize}`,
	);
	if (pending.length === 0) return;

	const buffer: Resolved[] = [];
	let done = 0;
	const tally = { female: 0, male: 0, other: 0, group_or_unlinked: 0 };

	for (const artist of pending) {
		let resolved: Resolved;
		try {
			resolved = await resolveArtist(artist.spotify_id);
		} catch (err) {
			// Transient error: skip without marking checked, so a rerun retries it.
			console.error(`  ! ${artist.name}: ${err instanceof Error ? err.message : err}`);
			continue;
		}
		buffer.push(resolved);
		if (resolved.gender) tally[resolved.gender]++;
		else tally.group_or_unlinked++;
		done++;

		if (buffer.length >= batchSize) {
			await flush(buffer.splice(0));
			console.log(
				`  ${done}/${pending.length}  (f:${tally.female} m:${tally.male} o:${tally.other} none:${tally.group_or_unlinked})`,
			);
		}
	}
	await flush(buffer.splice(0));

	console.log(`\nDone. Resolved ${done}/${pending.length}.`);
	console.log(`  female: ${tally.female}  male: ${tally.male}  other: ${tally.other}`);
	console.log(`  group/unlinked (gender null): ${tally.group_or_unlinked}`);
}

await main();
