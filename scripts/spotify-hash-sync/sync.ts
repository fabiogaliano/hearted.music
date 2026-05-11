import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SESSION = "spotify-hash-sync";
const HASH_REGISTRY_PATH = resolve(
	import.meta.dirname,
	"../../extension/src/shared/hash-registry.ts",
);
const PROFILE_DIR = resolve(import.meta.dirname, "../../.playwright/profile");
const AUTH_STATE_PATH = resolve(
	import.meta.dirname,
	"../../.playwright/spotify-auth.json",
);

const TRACKED_OPS = [
	"fetchLibraryTracks",
	"libraryV3",
	"fetchPlaylistContents",
	"fetchPlaylist",
	"profileAttributes",
	"addToPlaylist",
	"removeFromPlaylist",
	"queryArtistOverview",
	"getTrack",
] as const;

const SPOTIFY_PAGES = {
	library: "https://open.spotify.com/collection/tracks",
	playlist: "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M",
	artist: "https://open.spotify.com/artist/246dkjvS1zLTtiykXe5h60",
	track: "https://open.spotify.com/track/7tFiyTwD0nx5a1eklYtX2J",
} as const;

type OpName = (typeof TRACKED_OPS)[number];

const args = new Set(process.argv.slice(2));
const isLogin = args.has("--login");
const isHeaded = args.has("--headed");

function cli(command: string, opts?: { timeout?: number }): string {
	const timeout = opts?.timeout ?? 30_000;
	try {
		return execSync(`bunx playwright-cli -s=${SESSION} ${command}`, {
			encoding: "utf-8",
			timeout,
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
	} catch (e: unknown) {
		const err = e as { stdout?: string; stderr?: string; message?: string };
		const stdout = err.stdout?.trim() ?? "";
		const stderr = err.stderr?.trim() ?? "";
		if (stdout) return stdout;
		throw new Error(
			`playwright-cli failed: ${command}\n${stderr || err.message}`,
		);
	}
}

function wait(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

function parseCurrentHashes(): Record<string, string> {
	const source = readFileSync(HASH_REGISTRY_PATH, "utf-8");
	const hashes: Record<string, string> = {};
	const re = /(\w+):\s*\n?\s*"([a-f0-9]{64})"/g;
	let match: RegExpExecArray | null;
	while ((match = re.exec(source)) !== null) {
		hashes[match[1]] = match[2];
	}
	return hashes;
}

function patchHashRegistry(updates: Record<string, string>): void {
	let source = readFileSync(HASH_REGISTRY_PATH, "utf-8");
	for (const [op, newHash] of Object.entries(updates)) {
		const patterns = [
			new RegExp(`(${op}:\\s*\\n\\s*)"[a-f0-9]{64}"`, "g"),
			new RegExp(`(${op}:\\s*)"[a-f0-9]{64}"`, "g"),
		];
		let replaced = false;
		for (const pattern of patterns) {
			pattern.lastIndex = 0;
			if (pattern.test(source)) {
				pattern.lastIndex = 0;
				source = source.replace(pattern, `$1"${newHash}"`);
				replaced = true;
				break;
			}
		}
		if (!replaced) {
			console.warn(`  ⚠ Could not find ${op} in hash-registry.ts to patch`);
		}
	}
	writeFileSync(HASH_REGISTRY_PATH, source);
}

function parseRequestIndices(output: string): number[] {
	const indices: number[] = [];
	for (const line of output.split("\n")) {
		const m = line.match(/^(\d+)\.\s+\[POST\]/);
		if (m) indices.push(Number(m[1]));
	}
	return indices;
}

async function capturePathfinderHashes(): Promise<Map<string, string>> {
	const captured = new Map<string, string>();

	const output = cli('requests --filter "pathfinder"');
	const indices = parseRequestIndices(output);

	if (indices.length === 0) return captured;

	for (const idx of indices) {
		try {
			const bodyRaw = cli(`request-body ${idx} --raw`);
			if (!bodyRaw) continue;
			const body = JSON.parse(bodyRaw);
			const opName: string | undefined = body.operationName;
			const hash: string | undefined =
				body.extensions?.persistedQuery?.sha256Hash;
			if (opName && hash && TRACKED_OPS.includes(opName as OpName)) {
				captured.set(opName, hash);
			}
		} catch {
			// non-JSON body or other issue — skip
		}
	}

	return captured;
}

async function navigateAndCapture(
	label: string,
	url: string,
	alreadyCaptured: Map<string, string>,
	waitMs = 4000,
): Promise<Map<string, string>> {
	console.log(`\n→ ${label}`);
	cli("requests --clear");
	cli(`goto "${url}"`, { timeout: 60_000 });
	await wait(waitMs);
	const hashes = await capturePathfinderHashes();
	let newCount = 0;
	for (const [op, hash] of hashes) {
		if (!alreadyCaptured.has(op)) {
			console.log(`  ✓ ${op} → ${hash.substring(0, 16)}…`);
			newCount++;
		}
	}
	if (newCount === 0 && hashes.size > 0) {
		console.log(`  (${hashes.size} ops, all already captured)`);
	} else if (hashes.size === 0) {
		console.log("  (no tracked pathfinder operations captured)");
	}
	return hashes;
}

// --- Snapshot-based UI helpers ---

function extractRef(line: string): string | null {
	const m = line.match(/\[ref=(\w+)\]/);
	return m ? m[1] : null;
}

function findRef(
	snapshot: string,
	pattern: RegExp,
): string | null {
	for (const line of snapshot.split("\n")) {
		if (pattern.test(line)) {
			const ref = extractRef(line);
			if (ref) return ref;
		}
	}
	return null;
}

function findAllRefs(
	snapshot: string,
	pattern: RegExp,
): Array<{ ref: string; text: string }> {
	const results: Array<{ ref: string; text: string }> = [];
	for (const line of snapshot.split("\n")) {
		if (pattern.test(line)) {
			const ref = extractRef(line);
			if (ref) results.push({ ref, text: line.trim() });
		}
	}
	return results;
}

async function captureMutationHashes(): Promise<Map<string, string>> {
	const captured = new Map<string, string>();

	console.log("\n→ Mutation capture: addToPlaylist / removeFromPlaylist");
	console.log("  Strategy: add a track to a playlist via UI, then remove it.\n");

	try {
		// Step 1: Navigate to the track page
		cli(`goto "${SPOTIFY_PAGES.track}"`, { timeout: 60_000 });
		await wait(3000);

		// Step 2: Snapshot and find the "More options" / "..." button
		let snap = cli("snapshot");
		const moreBtn =
			findRef(snap, /button.*[Mm]ore options/i) ??
			findRef(snap, /button.*\.\.\./);

		if (!moreBtn) {
			console.log("  ⚠ Could not find 'More options' button on track page.");
			console.log("    Snapshot excerpt (first 40 lines):");
			for (const line of snap.split("\n").slice(0, 40)) {
				console.log(`      ${line}`);
			}
			return captured;
		}

		console.log(`  Click: ${moreBtn} (More options)`);
		cli(`click "${moreBtn}"`);
		await wait(1000);

		// Step 3: Snapshot the context menu, find "Add to playlist"
		snap = cli("snapshot");
		const addToPlaylistItem =
			findRef(snap, /menuitem.*[Aa]dd to playlist/i) ??
			findRef(snap, /[Aa]dd to playlist/i);

		if (!addToPlaylistItem) {
			console.log("  ⚠ Could not find 'Add to playlist' in context menu.");
			console.log("    Snapshot excerpt (first 40 lines):");
			for (const line of snap.split("\n").slice(0, 40)) {
				console.log(`      ${line}`);
			}
			cli("press Escape");
			return captured;
		}

		console.log(`  Hover: ${addToPlaylistItem} (Add to playlist)`);
		cli(`hover "${addToPlaylistItem}"`);
		await wait(1000);

		// Step 4: Snapshot full page — submenu renders as a sibling menu element
		snap = cli("snapshot");

		// Find menuitems that have a quoted name (skips empty/search items)
		// and aren't navigation or action items from the parent menu
		const skipPatterns =
			/new playlist|find a playlist|add to playlist|save to|exclude from|go to|view credits|share|open in|song radio/i;
		const playlistItems = findAllRefs(snap, /menuitem "/)
			.filter((p) => !skipPatterns.test(p.text));
		const targetPlaylist = playlistItems[0];

		if (!targetPlaylist) {
			console.log("  ⚠ Could not find a user playlist in the submenu.");
			console.log("    Available items:");
			for (const p of playlistItems) {
				console.log(`      ${p.text}`);
			}
			cli("press Escape");
			return captured;
		}

		// Step 5: Clear requests and click the playlist to trigger addToPlaylist
		cli("requests --clear");
		console.log(`  Click: ${targetPlaylist.ref} (${targetPlaylist.text})`);
		cli(`click "${targetPlaylist.ref}"`);
		await wait(2000);

		// Handle "already in playlist" confirmation dialog
		snap = cli("snapshot");
		const addAnywayBtn = findRef(snap, /button.*[Aa]dd anyway/i);
		if (addAnywayBtn) {
			console.log(`  Click: ${addAnywayBtn} (Add anyway — duplicate dialog)`);
			cli(`click "${addAnywayBtn}"`);
			await wait(2000);
		}

		// Step 6: Capture addToPlaylist hash
		const addHashes = await capturePathfinderHashes();
		for (const [op, hash] of addHashes) {
			if (op === "addToPlaylist" || op === "removeFromPlaylist") {
				captured.set(op, hash);
				console.log(`  ✓ ${op} → ${hash.substring(0, 16)}…`);
			}
		}

		if (!captured.has("addToPlaylist")) {
			console.log("  ⚠ addToPlaylist not captured after add action.");
			return captured;
		}

		// addToPlaylist and removeFromPlaylist share the same hash
		captured.set("removeFromPlaylist", captured.get("addToPlaylist")!);
		console.log(
			`  ✓ removeFromPlaylist → shared hash invariant applied`,
		);
	} catch (err) {
		console.log(`  ⚠ Mutation capture failed: ${err}`);
		console.log("    Run with --headed to debug UI interactions.");
	}

	return captured;
}

async function main() {
	console.log("┌─────────────────────────────────────────┐");
	console.log("│  hearted. — Spotify Hash Sync           │");
	console.log("└─────────────────────────────────────────┘");

	const currentHashes = parseCurrentHashes();
	console.log(
		`\nTracking ${TRACKED_OPS.length} operations, ${Object.keys(currentHashes).length} currently in DEFAULT_HASHES`,
	);

	const headedFlag = isHeaded || isLogin ? " --headed" : "";
	const openFlags = `--persistent --profile "${PROFILE_DIR}" --browser chrome${headedFlag}`;

	if (isLogin) {
		console.log("\nLogin mode — opening headed browser.");
		console.log("Log in to Spotify, then press Enter here to continue.\n");
		cli(`open "https://open.spotify.com" ${openFlags}`, {
			timeout: 300_000,
		});
		process.stdin.setRawMode?.(false);
		process.stdout.write("Press Enter after logging in… ");
		await new Promise<void>((resolve) => {
			process.stdin.once("data", () => resolve());
			process.stdin.resume();
		});
		cli(`state-save "${AUTH_STATE_PATH}"`);
		console.log("Auth state saved. Run again without --login to sync.\n");

		cli("close");
		process.exit(0);
	}

	console.log(
		`\nOpening persistent browser session${isHeaded ? " (headed)" : ""}…`,
	);
	cli(`open ${openFlags}`, { timeout: 60_000 });

	if (existsSync(AUTH_STATE_PATH)) {
		console.log("Loading saved auth state…");
		cli(`state-load "${AUTH_STATE_PATH}"`);
	}

	cli(`goto "https://open.spotify.com"`, { timeout: 60_000 });
	await wait(5000);

	const allCaptured = new Map<string, string>();

	// --- Read operations ---

	const libraryHashes = await navigateAndCapture(
		"Library (liked songs)",
		SPOTIFY_PAGES.library,
		allCaptured,
	);
	for (const [k, v] of libraryHashes) allCaptured.set(k, v);

	const playlistHashes = await navigateAndCapture(
		"Playlist (Today's Top Hits)",
		SPOTIFY_PAGES.playlist,
		allCaptured,
	);
	for (const [k, v] of playlistHashes) allCaptured.set(k, v);

	const artistHashes = await navigateAndCapture(
		"Artist (Post Malone)",
		SPOTIFY_PAGES.artist,
		allCaptured,
	);
	for (const [k, v] of artistHashes) allCaptured.set(k, v);

	const trackHashes = await navigateAndCapture(
		"Track page",
		SPOTIFY_PAGES.track,
		allCaptured,
	);
	for (const [k, v] of trackHashes) allCaptured.set(k, v);

	if (!allCaptured.has("profileAttributes")) {
		console.log("\n→ Profile: reloading to capture profileAttributes…");
		cli("requests --clear");
		cli("reload", { timeout: 30_000 });
		await wait(3000);
		const reloadHashes = await capturePathfinderHashes();
		for (const [k, v] of reloadHashes) allCaptured.set(k, v);
	}

	// --- Mutation operations ---

	if (
		!allCaptured.has("addToPlaylist") ||
		!allCaptured.has("removeFromPlaylist")
	) {
		const mutationHashes = await captureMutationHashes();
		for (const [k, v] of mutationHashes) allCaptured.set(k, v);
	}

	cli("close");

	// Enforce addToPlaylist/removeFromPlaylist shared hash invariant
	const addHash = allCaptured.get("addToPlaylist");
	const removeHash = allCaptured.get("removeFromPlaylist");
	if (addHash && !removeHash) allCaptured.set("removeFromPlaylist", addHash);
	if (removeHash && !addHash) allCaptured.set("addToPlaylist", removeHash);

	console.log("\n─── Results ───────────────────────────────");

	const changed: Record<string, string> = {};
	const unchanged: string[] = [];
	const missing: string[] = [];

	for (const op of TRACKED_OPS) {
		const newHash = allCaptured.get(op);
		const oldHash = currentHashes[op];
		if (!newHash) {
			missing.push(op);
		} else if (newHash !== oldHash) {
			changed[op] = newHash;
			console.log(`  CHANGED  ${op}`);
			console.log(`           old: ${oldHash ?? "(none)"}`);
			console.log(`           new: ${newHash}`);
		} else {
			unchanged.push(op);
		}
	}

	if (unchanged.length > 0) {
		console.log(
			`\n  Unchanged (${unchanged.length}): ${unchanged.join(", ")}`,
		);
	}
	if (missing.length > 0) {
		console.log(
			`\n  ⚠ Not captured (${missing.length}): ${missing.join(", ")}`,
		);
	}

	if (Object.keys(changed).length > 0) {
		console.log(`\nPatching ${HASH_REGISTRY_PATH}…`);
		patchHashRegistry(changed);
		console.log("Done — DEFAULT_HASHES updated.\n");
	} else {
		console.log("\nAll captured hashes match — no update needed.\n");
	}
}

main().catch((err) => {
	console.error("Fatal:", err);
	try {
		cli("close");
	} catch {}
	process.exit(1);
});
