/**
 * Backfill song.release_year on PROD by calling Spotify's getTrack for every song
 * that has no year yet.
 *
 * Why this shape:
 *  - getTrack is the only op that carries a clean albumOfTrack.date.year for an
 *    arbitrary track (fetchLibraryTracks — the liked-songs source — has no date),
 *    so liked-only songs can only be filled this way.
 *  - pathfinder rejects calls made from Node (bot protection keys on the browser
 *    TLS/context, and the bearer alone isn't enough — it also needs client-token).
 *    So the getTrack fetches run *inside* the authenticated browser page via
 *    Playwright `eval`, reusing the same persistent profile as hash:sync. The page
 *    supplies the right context; we inject the captured token + client-token + the
 *    live persisted-query hash. Batched with in-page concurrency for throughput.
 *
 * Usage:
 *   bun run backfill:release-year                 # dry run — fetch, write nothing
 *   bun run backfill:release-year -- --limit=300  # cap songs this run
 *   bun run backfill:release-year -- --commit     # write resolved years to prod
 *
 * Prereq: the release_year column + trigger migration must already be on prod
 * (`supabase db push`). The script refuses to run if the column is absent.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SESSION = "rybf"; // short: keeps the macOS unix-socket path under 104 chars
const ROOT = resolve(import.meta.dirname, "../..");
const PROFILE_DIR = resolve(ROOT, ".playwright/profile");
const AUTH_STATE_PATH = resolve(ROOT, ".playwright/spotify-auth.json");
const HASH_REGISTRY_PATH = resolve(
	ROOT,
	"extensions/src/shared/hash-registry.ts",
);
const CACHE_PATH = resolve(import.meta.dirname, ".release-year-cache.json");
const PATHFINDER_URL = "https://api-partner.spotify.com/pathfinder/v2/query";
// Any track page forces Spotify to fire a getTrack pathfinder request we harvest
// the token / client-token / live hash from.
const TOKEN_SEED_PAGE = "https://open.spotify.com/track/4PTG3Z6ehGkBFwjybzWkR8";

const BATCH_SIZE = 200; // ids per in-page eval call
const IN_PAGE_CONCURRENCY = 5; // concurrent fetches inside the page
const WRITE_CHUNK = 500;

const argv = process.argv.slice(2);
const COMMIT = argv.includes("--commit");
// --local routes all DB I/O at the local Supabase DSN (for safe end-to-end
// testing of the fetch/cache/write pipeline before pointing at prod).
const LOCAL = argv.includes("--local");
const LOCAL_DSN = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const DB_URL_FLAG = LOCAL ? `--url ${LOCAL_DSN} ` : "";
const limitFlag = argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitFlag
	? Math.max(1, Number.parseInt(limitFlag.split("=")[1], 10))
	: Number.POSITIVE_INFINITY;

type SongRow = { id: string; spotify_id: string };
// Cache value: a number = resolved year; "no_date" = Spotify has the track but no
// release date (don't refetch). Transient failures are NOT cached so they retry.
type CacheValue = number | "no_date";
type Cache = Record<string, CacheValue>;

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function pw(command: string, opts?: { timeout?: number }): string {
	try {
		return execSync(`playwright-cli -s=${SESSION} ${command}`, {
			encoding: "utf-8",
			timeout: opts?.timeout ?? 30_000,
			stdio: ["pipe", "pipe", "pipe"],
			// hash:sync relies on `bun run` putting node_modules/.bin on PATH; set it
			// explicitly so this works however the script is launched.
			env: {
				...process.env,
				PATH: `${ROOT}/node_modules/.bin:${process.env.PATH}`,
			},
			maxBuffer: 32 * 1024 * 1024,
		}).trim();
	} catch (e: unknown) {
		const err = e as { stdout?: string; stderr?: string; message?: string };
		if (err.stdout?.trim()) return err.stdout.trim();
		throw new Error(
			`playwright-cli failed: ${command}\n${err.stderr ?? err.message}`,
		);
	}
}

function wait(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

// --- prod DB I/O via the supabase-prod tool ---------------------------------

function prodSqlRead<T>(query: string): T {
	const out = execSync(`bun run prod:sql --json ${DB_URL_FLAG}${JSON.stringify(query)}`, {
		encoding: "utf-8",
		timeout: 120_000,
		maxBuffer: 64 * 1024 * 1024,
	});
	const start = out.indexOf("[");
	if (start === -1) throw new Error(`No JSON in prod:sql output:\n${out}`);
	const end = out.lastIndexOf("]");
	return JSON.parse(out.slice(start, end + 1)) as T;
}

function prodSqlWriteFile(sqlPath: string): void {
	execSync(`bun run prod:sql --write --yes ${DB_URL_FLAG}-f ${JSON.stringify(sqlPath)}`, {
		encoding: "utf-8",
		timeout: 120_000,
		stdio: ["pipe", "inherit", "inherit"],
	});
}

// --- session: token + client-token + live hash ------------------------------

type Session = { token: string; clientToken: string; hash: string };
let sessionOpen = false;

function storedGetTrackHash(): string {
	const src = readFileSync(HASH_REGISTRY_PATH, "utf-8");
	const m = src.match(/getTrack:\s*\n?\s*"([a-f0-9]{64})"/);
	if (!m) throw new Error("getTrack hash not found in hash-registry.ts");
	return m[1];
}

function headerValue(headers: string, name: string): string | null {
	const m = headers.match(new RegExp(`^${name}:\\s*(.+)$`, "im"));
	return m ? m[1].trim() : null;
}

async function mintSession(): Promise<Session> {
	if (!sessionOpen) {
		pw(`open --persistent --profile "${PROFILE_DIR}" --browser chrome`, {
			timeout: 60_000,
		});
		if (existsSync(AUTH_STATE_PATH)) pw(`state-load "${AUTH_STATE_PATH}"`);
		sessionOpen = true;
	}

	// Force a fresh getTrack so we capture a current token + client-token + hash.
	for (let attempt = 0; attempt < 3; attempt++) {
		pw("requests --clear");
		pw(`goto "${TOKEN_SEED_PAGE}"`, { timeout: 60_000 });
		await wait(6000);

		const indices = [
			...pw('requests --filter "pathfinder"').matchAll(/^(\d+)\.\s+\[POST\]/gm),
		].map((m) => Number(m[1]));

		for (const idx of indices) {
			let body: { operationName?: string; extensions?: { persistedQuery?: { sha256Hash?: string } } };
			try {
				body = JSON.parse(pw(`request-body ${idx}`));
			} catch {
				continue;
			}
			if (body.operationName !== "getTrack") continue;
			const headers = pw(`request-headers ${idx}`);
			const token = headerValue(headers, "authorization");
			const clientToken = headerValue(headers, "client-token");
			if (token && clientToken) {
				return {
					token,
					clientToken,
					hash: body.extensions?.persistedQuery?.sha256Hash ?? storedGetTrackHash(),
				};
			}
		}
	}

	throw new Error(
		"Could not capture a Spotify token + client-token. Is the saved auth still valid? " +
			"Re-login with: bun scripts/spotify-hash-sync/sync.ts --login",
	);
}

// --- in-page getTrack batch --------------------------------------------------

function parseEvalResult(raw: string): unknown {
	const m = raw.match(/### Result\n([\s\S]*?)\n### /);
	const text = (m ? m[1] : raw).trim();
	// The in-page fn returns JSON.stringify(...), which the CLI prints as a quoted
	// JSON string — so parse once to unwrap the string, then again for the object.
	let parsed: unknown = JSON.parse(text);
	if (typeof parsed === "string") parsed = JSON.parse(parsed);
	return parsed;
}

/** Builds the in-page fetch function: getTrack for each id with bounded
 *  concurrency, returning a JSON map of id -> { s: status, y?: year }. */
function buildBatchFn(ids: string[], session: Session): string {
	return `async()=>{
		const ids=${JSON.stringify(ids)};
		const out={}; let i=0;
		async function worker(){
			while(i<ids.length){
				const id=ids[i++];
				try{
					const r=await fetch(${JSON.stringify(PATHFINDER_URL)},{
						method:"POST",
						headers:{
							"authorization":${JSON.stringify(session.token)},
							"client-token":${JSON.stringify(session.clientToken)},
							"content-type":"application/json;charset=UTF-8",
							"accept":"application/json"
						},
						body:JSON.stringify({variables:{uri:"spotify:track:"+id},operationName:"getTrack",extensions:{persistedQuery:{version:1,sha256Hash:${JSON.stringify(session.hash)}}}})
					});
					let j=null; try{ j=JSON.parse(await r.text()); }catch{}
					out[id]={s:r.status,y:j?.data?.trackUnion?.albumOfTrack?.date?.year};
				}catch(e){ out[id]={s:-1}; }
			}
		}
		await Promise.all(Array.from({length:${IN_PAGE_CONCURRENCY}},()=>worker()));
		return JSON.stringify(out);
	}`;
}

type BatchOutcome = {
	years: Map<string, number>; // spotify_id -> year
	noDate: string[]; // spotify_id with a definitive no-date answer
	tokenExpired: boolean; // 401s seen → caller should re-mint
	transientFailures: number; // 429/-1/other — not cached, retried next run
};

function runBatchInPage(ids: string[], session: Session): BatchOutcome {
	const b64 = Buffer.from(buildBatchFn(ids, session)).toString("base64");
	const wrapper = `() => (0,eval)(atob(${JSON.stringify(b64)}))()`;
	const raw = pw(`eval ${JSON.stringify(wrapper)}`, { timeout: 120_000 });
	const parsed = parseEvalResult(raw) as Record<string, { s: number; y?: number }>;

	const years = new Map<string, number>();
	const noDate: string[] = [];
	let tokenExpired = false;
	let transientFailures = 0;

	for (const id of ids) {
		const r = parsed[id];
		if (!r) {
			transientFailures++;
			continue;
		}
		if (r.s === 401) {
			tokenExpired = true;
			continue;
		}
		if (r.s === 200) {
			if (typeof r.y === "number" && r.y > 0) years.set(id, r.y);
			else noDate.push(id);
			continue;
		}
		transientFailures++; // 403/429/-1/etc.
	}
	return { years, noDate, tokenExpired, transientFailures };
}

// --- cache + write -----------------------------------------------------------

function loadCache(): Cache {
	if (!existsSync(CACHE_PATH)) return {};
	try {
		return JSON.parse(readFileSync(CACHE_PATH, "utf-8")) as Cache;
	} catch {
		return {};
	}
}

function buildUpdateSql(rows: Array<{ id: string; year: number }>): string {
	const values = rows
		.map((r) => `('${r.id}'::uuid, ${r.year}::smallint)`)
		.join(",\n\t\t");
	return `update song as s set release_year = v.year
from (values
		${values}
	) as v(id, year)
where s.id = v.id;`;
}

// --- main --------------------------------------------------------------------

async function main() {
	console.log(
		`Release-year backfill — ${LOCAL ? "LOCAL" : "PROD"} — ${COMMIT ? "COMMIT" : "DRY RUN"}\n`,
	);

	// 0. Guard: prod must have the column (migration pushed).
	const [{ has_col }] = prodSqlRead<Array<{ has_col: number }>>(
		"select count(*)::int as has_col from information_schema.columns where table_name='song' and column_name='release_year'",
	);
	if (Number(has_col) === 0) {
		console.error(
			"✗ prod song table has no release_year column. Apply the migration to prod first:\n" +
				"    supabase db push\n" +
				"  then re-run this backfill.",
		);
		process.exit(1);
	}

	// 1. Songs needing a year, minus what the local cache already resolved.
	let songs = prodSqlRead<SongRow[]>(
		"select id, spotify_id from song where release_year is null and spotify_id is not null order by created_at",
	);
	console.log(`${songs.length} songs missing release_year on ${LOCAL ? "local" : "prod"}.`);

	const cache = loadCache();
	const idBySpotify = new Map<string, string>(); // spotify_id -> song.id (this run)
	const cachedYears = new Map<string, number>(); // song.id -> year (from cache)
	songs = songs.filter((s) => {
		idBySpotify.set(s.spotify_id, s.id);
		const cached = cache[s.spotify_id];
		if (cached === undefined) return true;
		if (typeof cached === "number") cachedYears.set(s.id, cached);
		return false; // resolved (year or no_date) — skip fetch
	});
	if (cachedYears.size > 0 || songs.length === 0) {
		console.log(`${cachedYears.size} year(s) already in local cache.`);
	}

	const toFetch = Number.isFinite(LIMIT) ? songs.slice(0, LIMIT) : songs;
	console.log(`Fetching getTrack for ${toFetch.length} songs (batch ${BATCH_SIZE})…\n`);

	const resolved = new Map<string, number>(cachedYears); // song.id -> year
	let noDateCount = 0;
	let transientCount = 0;

	if (toFetch.length > 0) {
		let session = await mintSession();
		const batches: SongRow[][] = [];
		for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
			batches.push(toFetch.slice(i, i + BATCH_SIZE));
		}

		for (let b = 0; b < batches.length; b++) {
			const batch = batches[b];
			const ids = batch.map((s) => s.spotify_id);
			let outcome = runBatchInPage(ids, session);
			if (outcome.tokenExpired && outcome.years.size === 0) {
				session = await mintSession();
				outcome = runBatchInPage(ids, session);
			}

			for (const [spotifyId, year] of outcome.years) {
				cache[spotifyId] = year;
				const songId = idBySpotify.get(spotifyId);
				if (songId) resolved.set(songId, year);
			}
			for (const spotifyId of outcome.noDate) cache[spotifyId] = "no_date";
			noDateCount += outcome.noDate.length;
			transientCount += outcome.transientFailures;

			// Persist cache after every batch so a crash never loses progress.
			writeFileSync(CACHE_PATH, JSON.stringify(cache));
			console.log(
				`  batch ${b + 1}/${batches.length} — +${outcome.years.size} years, ${outcome.noDate.length} no-date, ${outcome.transientFailures} retry-later`,
			);
		}

		if (sessionOpen) pw("close");
	}

	console.log(
		`\nResolved years: ${resolved.size} | no release date: ${noDateCount} | failed (retry next run): ${transientCount}`,
	);

	if (resolved.size === 0) {
		console.log("\nNothing to write.");
		return;
	}

	const writeRows = [...resolved].map(([id, year]) => ({ id, year }));
	if (writeRows.some((r) => !UUID_RE.test(r.id) || !Number.isInteger(r.year))) {
		throw new Error("Refusing to write: malformed id/year in result set.");
	}

	if (!COMMIT) {
		console.log(
			`\nDRY RUN — would update ${writeRows.length} prod rows. Re-run with --commit to write.`,
		);
		console.log("Sample:", writeRows.slice(0, 5));
		return;
	}

	console.log(
		`\nWriting ${writeRows.length} rows to ${LOCAL ? "local" : "prod"} in chunks of ${WRITE_CHUNK}…`,
	);
	const tmpSql = resolve(import.meta.dirname, ".release-year-write.sql");
	const chunks: Array<typeof writeRows> = [];
	for (let i = 0; i < writeRows.length; i += WRITE_CHUNK) {
		chunks.push(writeRows.slice(i, i + WRITE_CHUNK));
	}
	for (let i = 0; i < chunks.length; i++) {
		writeFileSync(tmpSql, buildUpdateSql(chunks[i]));
		prodSqlWriteFile(tmpSql);
		console.log(`  chunk ${i + 1}/${chunks.length} written`);
	}
	console.log("\nDone.");
}

main().catch((err) => {
	console.error("Fatal:", err);
	try {
		if (sessionOpen) pw("close");
	} catch {}
	process.exit(1);
});
