/**
 * Copy artist.image_url/bio from local DB rows that already have an image
 * (e.g. resolved via backfill-artist-images.ts --target=local) to matching
 * prod rows that are still null. Pure DB-to-DB copy — no Spotify calls, so
 * no pacing/token needed. The prod-side filter (image_url=is.null) makes
 * this safe to rerun: it only ever fills gaps, never overwrites.
 *
 * Usage:
 *   bun run scripts/matching-lab/artist-images/sync-artist-images-to-prod.ts [--dry-run] [--limit 500]
 */

import { resolve } from "node:path";

const REPO_ROOT = process.cwd();
const PROD_TOOL = resolve(REPO_ROOT, "scripts/db/prod.ts");
const LOCAL_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const CONCURRENCY = 8;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const limitArg = args.indexOf("--limit") !== -1 ? args[args.indexOf("--limit") + 1] : null;
const LIMIT = limitArg ? Number(limitArg) : null;

interface LocalRow {
	spotify_id: string;
	image_url: string;
	bio: string | null;
}

async function localSql(sql: string): Promise<unknown> {
	const proc = Bun.spawn(["bun", PROD_TOOL, "sql", "--url", LOCAL_URL, "--json", sql], {
		cwd: REPO_ROOT,
		stdout: "pipe",
		stderr: "inherit",
	});
	const out = await new Response(proc.stdout).text();
	if ((await proc.exited) !== 0) throw new Error("local db sql failed");
	const t = out.trim();
	return t ? JSON.parse(t) : [];
}

async function syncOne(row: LocalRow): Promise<"synced" | "skipped" | "error"> {
	const data = JSON.stringify({ image_url: row.image_url, bio: row.bio });
	const restArgs = [
		"rest",
		"update",
		"artist",
		"--eq",
		`spotify_id=${row.spotify_id}`,
		"--filter",
		"image_url=is.null",
		"--data",
		data,
		"--yes",
		"--json",
	];
	if (dryRun) return "skipped";
	const proc = Bun.spawn(["bun", PROD_TOOL, ...restArgs], {
		cwd: REPO_ROOT,
		stdout: "pipe",
		stderr: "pipe",
	});
	const out = await new Response(proc.stdout).text();
	const exited = await proc.exited;
	if (exited !== 0) return "error";
	const rows = JSON.parse(out.trim() || "[]");
	return Array.isArray(rows) && rows.length > 0 ? "synced" : "skipped";
}

async function main() {
	const pending = (await localSql(
		`select spotify_id, image_url, bio from artist where image_url is not null${LIMIT ? ` limit ${LIMIT}` : ""}`,
	)) as LocalRow[];

	console.log(
		`Syncing ${pending.length} local artist image(s) to prod (only where prod is still null)${dryRun ? " [DRY RUN]" : ""}`,
	);
	if (pending.length === 0) return;

	let synced = 0;
	let skipped = 0;
	let errored = 0;

	for (let i = 0; i < pending.length; i += CONCURRENCY) {
		const batch = pending.slice(i, i + CONCURRENCY);
		const results = await Promise.all(batch.map(syncOne));
		for (const r of results) {
			if (r === "synced") synced++;
			else if (r === "skipped") skipped++;
			else errored++;
		}
		console.log(
			`  ${Math.min(i + CONCURRENCY, pending.length)}/${pending.length}  synced:${synced} skipped:${skipped} errored:${errored}`,
		);
	}

	console.log(`\nDone. synced:${synced} skipped:${skipped} errored:${errored}`);
}

await main();
