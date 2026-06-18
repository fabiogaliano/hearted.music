import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

// Throwaway probe: confirms whether Spotify's intercepted pathfinder responses
// actually carry album release-date data (date / firstPublishedAt / year) on the
// operations we already drive, before committing to a migration + backfill.
// Reuses the same pre-authed persistent profile as hash:sync.

const SESSION = "dp";
const PROFILE_DIR = resolvePath(import.meta.dirname, "../../.playwright/profile");
const AUTH_STATE_PATH = resolvePath(
	import.meta.dirname,
	"../../.playwright/spotify-auth.json",
);

const PAGES: Array<{ label: string; url: string; op: string }> = [
	{
		label: "Track page → getTrack",
		url: "https://open.spotify.com/track/7tFiyTwD0nx5a1eklYtX2J",
		op: "getTrack",
	},
	{
		label: "Playlist → fetchPlaylistContents",
		url: "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M",
		op: "fetchPlaylistContents",
	},
];

const DATE_KEYS = new Set(["date", "firstPublishedAt", "releaseDate", "year"]);

function cli(command: string, opts?: { timeout?: number }): string {
	try {
		return execSync(`playwright-cli -s=${SESSION} ${command}`, {
			encoding: "utf-8",
			timeout: opts?.timeout ?? 30_000,
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
	} catch (e: unknown) {
		const err = e as { stdout?: string; stderr?: string; message?: string };
		if (err.stdout?.trim()) return err.stdout.trim();
		throw new Error(`playwright-cli failed: ${command}\n${err.stderr ?? err.message}`);
	}
}

function wait(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

function parseRequestIndices(output: string): number[] {
	const indices: number[] = [];
	for (const line of output.split("\n")) {
		const m = line.match(/^(\d+)\.\s+\[POST\]/);
		if (m) indices.push(Number(m[1]));
	}
	return indices;
}

// Walk a parsed response and collect every date-ish key with the path it lives at.
function collectDateFields(
	value: unknown,
	path: string,
	hits: Array<{ path: string; value: unknown }>,
): void {
	if (Array.isArray(value)) {
		// Only descend into the first couple of items — enough to prove presence.
		value.slice(0, 2).forEach((v, i) => collectDateFields(v, `${path}[${i}]`, hits));
		return;
	}
	if (value && typeof value === "object") {
		for (const [k, v] of Object.entries(value)) {
			const childPath = path ? `${path}.${k}` : k;
			if (DATE_KEYS.has(k)) hits.push({ path: childPath, value: v });
			collectDateFields(v, childPath, hits);
		}
	}
}

async function probePage(label: string, url: string, op: string): Promise<void> {
	console.log(`\n→ ${label}`);
	cli("requests --clear");
	cli(`goto "${url}"`, { timeout: 60_000 });
	await wait(5000);

	const indices = parseRequestIndices(cli('requests --filter "pathfinder"'));
	let found = false;

	for (const idx of indices) {
		let reqOp: string | undefined;
		try {
			reqOp = JSON.parse(cli(`request-body ${idx}`)).operationName;
		} catch {
			continue;
		}
		if (reqOp !== op) continue;

		found = true;
		const bodyRaw = cli(`response-body ${idx}`);
		let parsed: unknown;
		try {
			parsed = JSON.parse(bodyRaw);
		} catch {
			console.log("  ⚠ response body was not JSON (saved to file?)");
			continue;
		}

		const hits: Array<{ path: string; value: unknown }> = [];
		collectDateFields(parsed, "", hits);

		if (hits.length === 0) {
			console.log(`  ✗ ${op} response had NO date fields`);
		} else {
			console.log(`  ✓ ${op} response carries date data:`);
			const seen = new Set<string>();
			for (const h of hits) {
				// Collapse array-index noise so we print one example per logical path.
				const key = h.path.replace(/\[\d+\]/g, "[]");
				if (seen.has(key)) continue;
				seen.add(key);
				console.log(`      ${key} = ${JSON.stringify(h.value)}`);
			}
		}
		break;
	}

	if (!found) console.log(`  ⚠ No ${op} request captured on this page.`);
}

async function main() {
	console.log("Spotify release-date probe — reusing saved auth\n");

	cli(`open --persistent --profile "${PROFILE_DIR}" --browser chrome`, {
		timeout: 60_000,
	});
	if (existsSync(AUTH_STATE_PATH)) cli(`state-load "${AUTH_STATE_PATH}"`);
	cli(`goto "https://open.spotify.com"`, { timeout: 60_000 });
	await wait(5000);

	for (const page of PAGES) {
		await probePage(page.label, page.url, page.op);
	}

	cli("close");
	console.log("\nDone.");
}

main().catch((err) => {
	console.error("Fatal:", err);
	try {
		cli("close");
	} catch {}
	process.exit(1);
});
