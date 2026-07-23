/**
 * Backfill artist.image_url (and bio, if empty) from Spotify Pathfinder's
 * queryArtistOverview, for artists with a null image_url.
 *
 * Sequential with randomized human-like pacing (jittered delay + occasional
 * longer break) and random artist order, rather than a concurrent burst in
 * sorted-id order — this hits Spotify's internal API with a personal
 * session token, so it shouldn't look like a scripted sweep.
 *
 * No "checked_at" tracking column — Pathfinder can legitimately return no
 * image for some artists, so a rerun just re-attempts whatever is still
 * null. That's fine for an occasional manual backfill, but means it isn't
 * resumable/skip-already-tried the way backfill-band-gender.ts is.
 * Artists confirmed to have no Pathfinder image are logged to
 * docs/tmp/artist-image-backfill-missing-<target>.jsonl for review.
 *
 * local uses direct SQL (scripts/db/prod.ts sql --url <local>); prod uses
 * REST (scripts/db/prod.ts rest) since the direct Postgres port isn't
 * reachable from every machine, while the PostgREST HTTPS endpoint is.
 *
 * Usage:
 *   SPOTIFY_TOKEN="BQ..." bun run scripts/matching-lab/backfill-artist-images.ts --target=local
 *   SPOTIFY_TOKEN="BQ..." CLIENT_TOKEN="AAA..." bun run scripts/matching-lab/backfill-artist-images.ts --target=prod [--limit 200] [--dry-run]
 */

import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";

const REPO_ROOT = process.cwd();
const PROD_TOOL = resolve(REPO_ROOT, "scripts/db/prod.ts");
const LOCAL_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const PATHFINDER_URL = "https://api-partner.spotify.com/pathfinder/v2/query";
const QUERY_ARTIST_OVERVIEW_HASH =
	"ae0e2958a4ab645b35ca19ac04d0495ae12d9c5d7b7286217674801a9aab281a";

// Human-pacing: a base jittered gap between requests, plus an occasional
// longer "got distracted" pause every 15-35 requests.
const MIN_DELAY_MS = 700;
const MAX_DELAY_MS = 2200;
const BREAK_EVERY_MIN = 15;
const BREAK_EVERY_MAX = 35;
const BREAK_MIN_MS = 8_000;
const BREAK_MAX_MS = 20_000;

const args = process.argv.slice(2);
const targetArg = args.find((a) => a.startsWith("--target="))?.split("=")[1];
if (targetArg !== "local" && targetArg !== "prod") {
	console.error("Usage: --target=local|prod required (plus SPOTIFY_TOKEN env var)");
	process.exit(1);
}
const target = targetArg;
const dryRun = args.includes("--dry-run");
const limitArg = args.indexOf("--limit") !== -1 ? args[args.indexOf("--limit") + 1] : null;
const LIMIT = limitArg ? Number(limitArg) : null;
const MISSING_LOG_PATH = resolve(
	REPO_ROOT,
	`docs/tmp/artist-image-backfill-missing-${target}.jsonl`,
);

const token = process.env.SPOTIFY_TOKEN;
if (!token) {
	console.error("Set SPOTIFY_TOKEN env var (Bearer token from Spotify web player)");
	process.exit(1);
}
const clientToken = process.env.CLIENT_TOKEN;

// Pathfinder requires browser-like headers to avoid 403s (see backfill-playlist-songs.ts)
const PATHFINDER_HEADERS: Record<string, string> = {
	accept: "application/json",
	"accept-language": "en-GB",
	"app-platform": "WebPlayer",
	authorization: `Bearer ${token}`,
	"content-type": "application/json;charset=UTF-8",
	origin: "https://open.spotify.com",
	referer: "https://open.spotify.com/",
	"user-agent":
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
	...(clientToken ? { "client-token": clientToken } : {}),
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = (min: number, max: number) => min + Math.random() * (max - min);

async function dbSql(sql: string, opts: { write?: boolean } = {}): Promise<unknown> {
	const writeArgs = opts.write ? ["--write", "--yes"] : [];
	const proc = Bun.spawn(
		["bun", PROD_TOOL, "sql", "--url", LOCAL_URL, ...writeArgs, "--json", sql],
		{ cwd: REPO_ROOT, stdout: "pipe", stderr: "inherit" },
	);
	const out = await new Response(proc.stdout).text();
	if ((await proc.exited) !== 0) throw new Error("local db sql failed");
	const t = out.trim();
	return t ? JSON.parse(t) : [];
}

async function runProdTool(args: string[]): Promise<string> {
	const proc = Bun.spawn(["bun", PROD_TOOL, ...args], {
		cwd: REPO_ROOT,
		stdout: "pipe",
		stderr: "inherit",
	});
	const out = await new Response(proc.stdout).text();
	if ((await proc.exited) !== 0) throw new Error(`prod rest call failed: ${args.join(" ")}`);
	return out.trim();
}

function shuffle<T>(arr: T[]): T[] {
	for (let i = arr.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[arr[i], arr[j]] = [arr[j], arr[i]];
	}
	return arr;
}

interface Artist {
	spotify_id: string;
	name: string;
}

interface Resolved {
	spotify_id: string;
	image_url: string | null;
	bio: string | null;
}

class PathfinderAuthError extends Error {}

function pickBestImageUrl(
	sources: Array<{ url: string; width?: number; height?: number }>,
): string | null {
	if (sources.length === 0) return null;
	const best = sources.reduce((a, b) =>
		(b.width ?? 0) * (b.height ?? 0) > (a.width ?? 0) * (a.height ?? 0) ? b : a,
	);
	return best.url;
}

async function fetchOverview(artist: Artist): Promise<Resolved> {
	const res = await fetch(PATHFINDER_URL, {
		method: "POST",
		headers: PATHFINDER_HEADERS,
		body: JSON.stringify({
			variables: {
				uri: `spotify:artist:${artist.spotify_id}`,
				locale: "",
				preReleaseV2: false,
			},
			operationName: "queryArtistOverview",
			extensions: {
				persistedQuery: { version: 1, sha256Hash: QUERY_ARTIST_OVERVIEW_HASH },
			},
		}),
	});

	if (res.status === 401 || res.status === 403) {
		throw new PathfinderAuthError(`Pathfinder ${res.status} — token expired or invalid`);
	}
	if (res.status === 429) {
		const retryAfter = Number(res.headers.get("Retry-After")) || 5;
		console.log(`  rate limited, waiting ${retryAfter}s...`);
		await sleep(retryAfter * 1000);
		return fetchOverview(artist);
	}
	if (!res.ok) {
		throw new Error(`Pathfinder ${res.status} for ${artist.name} (${artist.spotify_id})`);
	}

	const json = await res.json();
	const overview = json.data?.artistUnion;
	const sources = overview?.visuals?.avatarImage?.sources ?? [];
	const bio = overview?.profile?.biography?.text ?? null;
	return {
		spotify_id: artist.spotify_id,
		image_url: pickBestImageUrl(sources),
		bio,
	};
}

function lit(v: string | null): string {
	return v === null ? "null::text" : `'${v.replace(/'/g, "''")}'::text`;
}

async function selectPending(limit: number | null): Promise<Artist[]> {
	if (target === "local") {
		return shuffle(
			(await dbSql(
				`select spotify_id, name from artist where image_url is null${limit ? ` limit ${limit}` : ""}`,
			)) as Artist[],
		);
	}
	const restArgs = [
		"rest",
		"get",
		"artist",
		"--select",
		"spotify_id,name",
		"--filter",
		"image_url=is.null",
		"--json",
	];
	if (limit) restArgs.push("--limit", String(limit));
	const out = await runProdTool(restArgs);
	return shuffle(JSON.parse(out || "[]") as Artist[]);
}

async function writeFound(row: Resolved): Promise<void> {
	if (dryRun) return;
	if (target === "local") {
		const sql = `
			update artist as a set
				image_url = ${lit(row.image_url)},
				bio = coalesce(a.bio, ${lit(row.bio)}),
				updated_at = now()
			where a.spotify_id = ${lit(row.spotify_id)};`;
		await dbSql(sql, { write: true });
		return;
	}
	const data = JSON.stringify({ image_url: row.image_url, bio: row.bio });
	await runProdTool([
		"rest",
		"update",
		"artist",
		"--eq",
		`spotify_id=${row.spotify_id}`,
		"--data",
		data,
		"--yes",
		"--json",
	]);
}

async function logMissing(artist: Artist): Promise<void> {
	const line = `${JSON.stringify({ ...artist, checked_at: new Date().toISOString() })}\n`;
	await appendFile(MISSING_LOG_PATH, line, "utf-8");
}

function nextBreakThreshold(): number {
	return Math.round(jitter(BREAK_EVERY_MIN, BREAK_EVERY_MAX));
}

async function main() {
	const pending = await selectPending(LIMIT);

	console.log(
		`Backfilling images for ${pending.length} artist(s) on ${target}${dryRun ? " [DRY RUN]" : ""}`,
	);
	if (pending.length === 0) return;

	let found = 0;
	let missing = 0;
	let errored = 0;
	let untilBreak = nextBreakThreshold();

	for (let i = 0; i < pending.length; i++) {
		const artist = pending[i];
		try {
			const result = await fetchOverview(artist);
			if (result.image_url) {
				found++;
				await writeFound(result);
			} else {
				missing++;
				await logMissing(artist);
			}
			console.log(
				`  ${i + 1}/${pending.length}  ${result.image_url ? "✓" : "✗"} ${artist.name}  (found:${found} missing:${missing} errored:${errored})`,
			);
		} catch (err) {
			if (err instanceof PathfinderAuthError) {
				console.error(`\n${err.message} — stopping. Grab a fresh SPOTIFY_TOKEN and rerun.`);
				process.exit(1);
			}
			errored++;
			console.error(`  ${i + 1}/${pending.length}  ! ${artist.name}: ${err}`);
		}

		if (i === pending.length - 1) break;

		untilBreak--;
		if (untilBreak <= 0) {
			const breakMs = jitter(BREAK_MIN_MS, BREAK_MAX_MS);
			console.log(`  ...pausing ${(breakMs / 1000).toFixed(1)}s...`);
			await sleep(breakMs);
			untilBreak = nextBreakThreshold();
		} else {
			await sleep(jitter(MIN_DELAY_MS, MAX_DELAY_MS));
		}
	}

	console.log(`\nDone. found:${found} missing:${missing} errored:${errored}`);
	if (missing > 0) {
		console.log(`Missing artists logged to ${MISSING_LOG_PATH}`);
	}
}

await main();
