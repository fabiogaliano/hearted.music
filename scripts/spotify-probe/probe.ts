/**
 * Spotify pathfinder probe — discovers what real fields are available per
 * track/artist beyond what the sync currently captures.
 *
 * Reuses the .playwright profile + auth state managed by
 * scripts/spotify-hash-sync/sync.ts. If the session is stale, run:
 *   bun scripts/spotify-hash-sync/sync.ts --login
 * first to refresh the saved Spotify auth.
 *
 * Flow: live token → fetchLibraryTracks(20) → getTrack + queryArtistOverview
 * on the sample → dump raw JSON + a field-coverage summary.
 */

import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SESSION = "spotify-probe";
const HASH_REGISTRY_PATH = resolve(
	import.meta.dirname,
	"../../extensions/src/shared/hash-registry.ts",
);
const PROFILE_DIR = resolve(import.meta.dirname, "../../.playwright/profile");
const AUTH_STATE_PATH = resolve(
	import.meta.dirname,
	"../../.playwright/spotify-auth.json",
);
const OUT_DIR = resolve(import.meta.dirname, "../../claudedocs");
const OUT_PATH = resolve(OUT_DIR, "spotify-probe-output.json");

const SAMPLE_SIZE = 20;
const MAX_ARTISTS = 8;

function cli(command: string, opts?: { timeout?: number }): string {
	const timeout = opts?.timeout ?? 30_000;
	try {
		return execSync(`playwright-cli -s=${SESSION} ${command}`, {
			encoding: "utf-8",
			timeout,
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
	} catch (e: unknown) {
		const err = e as { stdout?: string; stderr?: string; message?: string };
		const stdout = err.stdout?.trim() ?? "";
		if (stdout) return stdout;
		throw new Error(`playwright-cli failed: ${command}\n${err.stderr ?? err.message}`);
	}
}

function wait(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

function parseHashes(): Record<string, string> {
	const source = readFileSync(HASH_REGISTRY_PATH, "utf-8");
	const hashes: Record<string, string> = {};
	const re = /(\w+):\s*\n?\s*"([a-f0-9]{64})"/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(source)) !== null) hashes[m[1]] = m[2];
	return hashes;
}

/** Parse the result section out of playwright-cli's markdown-framed output. */
function resultSection(raw: string): string {
	const start = raw.indexOf("### Result");
	if (start < 0) return raw;
	const after = raw.slice(start + "### Result".length);
	const end = after.indexOf("### Ran Playwright code");
	return (end < 0 ? after : after.slice(0, end)).trim();
}

/** Grab the live Bearer token from a real pathfinder request's headers. */
function grabToken(): string {
	const list = cli('requests --filter "pathfinder"');
	const indices: number[] = [];
	for (const line of list.split("\n")) {
		const m = line.match(/^(\d+)\.\s+\[POST\]/);
		if (m) indices.push(Number(m[1]));
	}
	// Newest requests carry the freshest token; walk from the end.
	for (const idx of indices.reverse()) {
		const headers = cli(`request-headers ${idx}`);
		const m = headers.match(/authorization:\s*Bearer\s+([A-Za-z0-9_-]+)/i);
		if (m) return m[1];
	}
	throw new Error("No Bearer token found in pathfinder request headers");
}

/**
 * Eval a page expression. Passes the JS as a literal argv entry via execFileSync
 * (no shell) so embedded quotes in the expression can't break anything.
 */
function evalJson<T>(jsExpr: string): T {
	const out = execFileSync(
		"playwright-cli",
		[`-s=${SESSION}`, "eval", jsExpr],
		{ encoding: "utf-8", timeout: 60_000, stdio: ["pipe", "pipe", "pipe"] },
	);
	return JSON.parse(resultSection(out)) as T;
}

/** Build a page-context pathfinder POST as a single-quoted JS expression. */
function pathfinderExpr(
	token: string,
	operationName: string,
	hash: string,
	variables: Record<string, unknown>,
): string {
	const varsLiteral = JSON.stringify(variables).replace(/'/g, "\\'");
	return (
		"() => fetch('https://api-partner.spotify.com/pathfinder/v2/query', {" +
		"method:'POST'," +
		"headers:{Authorization:'Bearer " +
		token +
		"','Content-Type':'application/json'}," +
		"body: JSON.stringify({variables: JSON.parse('" +
		varsLiteral +
		"'), operationName:'" +
		operationName +
		"', extensions:{persistedQuery:{version:1, sha256Hash:'" +
		hash +
		"'}}})" +
		"}).then(r => r.json())"
	);
}

function keysOf(obj: unknown, prefix = "", depth = 2): string[] {
	if (!obj || typeof obj !== "object" || depth < 0) return [];
	const out: string[] = [];
	for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
		const path = prefix ? `${prefix}.${k}` : k;
		out.push(path);
		if (v && typeof v === "object" && !Array.isArray(v)) {
			out.push(...keysOf(v, path, depth - 1));
		}
	}
	return out;
}

async function main() {
	console.log("┌─────────────────────────────────────────┐");
	console.log("│  hearted. — Spotify Pathfinder Probe    │");
	console.log("└─────────────────────────────────────────┘\n");

	const hashes = parseHashes();
	for (const op of ["fetchLibraryTracks", "getTrack", "queryArtistOverview"]) {
		if (!hashes[op]) throw new Error(`Missing hash for ${op} in hash-registry.ts`);
	}

	const openFlags = `--persistent --profile "${PROFILE_DIR}" --browser chrome`;
	console.log("Opening browser session…");
	cli(`open ${openFlags}`, { timeout: 60_000 });
	if (existsSync(AUTH_STATE_PATH)) {
		// Persistent profile already carries the session cookies; state-load is a
		// best-effort top-up and errors harmlessly against a persistent context.
		try {
			cli(`state-load "${AUTH_STATE_PATH}"`);
		} catch {
			console.log("(state-load skipped — using persistent profile session)");
		}
	}
	// Land on the library so the web player fires real pathfinder calls, whose
	// request headers carry the live Bearer token (the get_access_token endpoint
	// is deprecated; the player keeps its token in a worker, not page state).
	cli(`goto "https://open.spotify.com/collection/tracks"`, { timeout: 60_000 });
	await wait(6000);

	console.log("Grabbing live token from pathfinder request headers…");
	let token: string;
	try {
		token = grabToken();
	} catch {
		cli("close");
		console.error(
			"\n⚠ No authenticated pathfinder traffic — session is likely stale.\n" +
				"   Refresh auth first:  bun scripts/spotify-hash-sync/sync.ts --login\n",
		);
		process.exit(1);
	}
	console.log(`✓ token acquired (${token.slice(0, 12)}…)\n`);

	console.log(`Fetching first ${SAMPLE_SIZE} liked songs…`);
	const lib = evalJson<{ data?: { me?: { library?: { tracks?: { items?: any[] } } } } }>(
		pathfinderExpr(token, "fetchLibraryTracks", hashes.fetchLibraryTracks, {
			offset: 0,
			limit: SAMPLE_SIZE,
		}),
	);
	const items = lib.data?.me?.library?.tracks?.items ?? [];
	console.log(`✓ ${items.length} tracks\n`);

	const trackUris: string[] = [];
	const artistUris = new Set<string>();
	for (const it of items) {
		const t = it?.track ?? it?.item?.data ?? it;
		const uri = t?.uri ?? t?._uri;
		if (uri) trackUris.push(uri);
		const arts = t?.artists?.items ?? t?.artists ?? [];
		for (const a of arts) {
			const au = a?.uri ?? a?.profile?.uri;
			if (au) artistUris.add(au);
		}
	}

	const trackDumps: unknown[] = [];
	console.log(`Probing getTrack on ${trackUris.length} tracks…`);
	for (const uri of trackUris) {
		try {
			const d = evalJson<unknown>(
				pathfinderExpr(token, "getTrack", hashes.getTrack, { uri }),
			);
			trackDumps.push(d);
			await wait(300);
		} catch (e) {
			console.log(`  ⚠ getTrack ${uri}: ${(e as Error).message}`);
		}
	}

	const artistDumps: unknown[] = [];
	const sampleArtists = [...artistUris].slice(0, MAX_ARTISTS);
	console.log(`Probing queryArtistOverview on ${sampleArtists.length} artists…`);
	for (const uri of sampleArtists) {
		try {
			const d = evalJson<unknown>(
				pathfinderExpr(token, "queryArtistOverview", hashes.queryArtistOverview, {
					uri,
					locale: "",
					preReleaseV2: false,
				}),
			);
			artistDumps.push(d);
			await wait(300);
		} catch (e) {
			console.log(`  ⚠ artist ${uri}: ${(e as Error).message}`);
		}
	}

	cli("close");

	if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
	writeFileSync(
		OUT_PATH,
		JSON.stringify({ library: lib, tracks: trackDumps, artists: artistDumps }, null, 2),
	);

	console.log("\n─── Field coverage ───────────────────────");
	const firstTrack = (trackDumps[0] as any)?.data?.trackUnion;
	if (firstTrack) {
		console.log("\ngetTrack → trackUnion keys:");
		for (const k of keysOf(firstTrack, "", 2)) console.log("  " + k);
	}
	const firstArtist = (artistDumps[0] as any)?.data?.artistUnion;
	if (firstArtist) {
		console.log("\nqueryArtistOverview → artistUnion keys:");
		for (const k of keysOf(firstArtist, "", 2)) console.log("  " + k);
	}
	console.log(`\nFull raw dump written to:\n  ${OUT_PATH}\n`);
}

main().catch((err) => {
	console.error("Fatal:", err);
	try {
		cli("close");
	} catch {}
	process.exit(1);
});
