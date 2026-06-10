/**
 * Compares the structural shape of captured-responses/ vs fixtures/ JSONs.
 * Reports: missing keys, type mismatches (null vs object), and new fields.
 *
 * Run: cd extension && bun run scripts/compare-shapes.ts
 */
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const CAPTURED = join(
	import.meta.dir,
	"../src/shared/spotify-client/captured-responses",
);
const FIXTURES = join(import.meta.dir, "../src/__tests__/fixtures");

type Diff =
	| { type: "missing_in_fixture"; path: string; capturedType: string }
	| { type: "missing_in_captured"; path: string; fixtureType: string }
	| { type: "type_mismatch"; path: string; captured: string; fixture: string };

function typeOf(val: unknown): string {
	if (val === null) return "null";
	if (Array.isArray(val)) return "array";
	return typeof val;
}

function diffStructure(
	captured: unknown,
	fixture: unknown,
	path: string,
	diffs: Diff[],
): void {
	const ct = typeOf(captured);
	const ft = typeOf(fixture);

	// Both null or same primitive — no diff
	if (ct === ft && ct !== "object" && ct !== "array") return;

	// Type mismatch (e.g. null vs object — the avatar case)
	if (ct !== ft) {
		diffs.push({ type: "type_mismatch", path, captured: ct, fixture: ft });
		return;
	}

	if (ct === "array") {
		const ca = captured as unknown[];
		const fa = fixture as unknown[];
		// Compare first element of each if both non-empty
		if (ca.length > 0 && fa.length > 0) {
			diffStructure(ca[0], fa[0], `${path}[0]`, diffs);
		} else if (ca.length > 0 && fa.length === 0) {
			diffs.push({
				type: "missing_in_fixture",
				path: `${path}[0]`,
				capturedType: typeOf(ca[0]),
			});
		} else if (ca.length === 0 && fa.length > 0) {
			diffs.push({
				type: "missing_in_captured",
				path: `${path}[0]`,
				fixtureType: typeOf(fa[0]),
			});
		}
		return;
	}

	if (ct === "object") {
		const co = captured as Record<string, unknown>;
		const fo = fixture as Record<string, unknown>;

		for (const key of Object.keys(co)) {
			const childPath = `${path}.${key}`;
			if (!(key in fo)) {
				diffs.push({
					type: "missing_in_fixture",
					path: childPath,
					capturedType: typeOf(co[key]),
				});
			} else {
				diffStructure(co[key], fo[key], childPath, diffs);
			}
		}
		for (const key of Object.keys(fo)) {
			if (!(key in co)) {
				diffs.push({
					type: "missing_in_captured",
					path: `${path}.${key}`,
					fixtureType: typeOf(fo[key]),
				});
			}
		}
	}
}

// Map captured-response filenames to fixture filenames
const NAME_MAP: Record<string, string> = {
	"spotify-response-profileAttributes.json": "profileAttributes.json",
	"spotify-response-fetchLibraryTracks.json": "fetchLibraryTracks.json",
	"spotify-response-fetchPlaylistContents.json": "fetchPlaylistContents.json",
	"spotify-response-libraryV3.json": "libraryV3.json",
	"spotify-response-queryArtistOverview.json": "queryArtistOverview.json",
	"spotify-response-isCurated.json": "isCurated.json",
};

const capturedFiles = readdirSync(CAPTURED);

for (const capturedFile of capturedFiles) {
	const fixtureName = NAME_MAP[capturedFile];

	if (!fixtureName) {
		console.log(`\n⚠️  ${capturedFile} — no corresponding fixture (new endpoint)`);
		const raw = JSON.parse(readFileSync(join(CAPTURED, capturedFile), "utf-8"));
		console.log("   Shape:", JSON.stringify(raw, null, 2).split("\n").slice(0, 15).join("\n"));
		continue;
	}

	const captured = JSON.parse(readFileSync(join(CAPTURED, capturedFile), "utf-8"));
	const fixture = JSON.parse(readFileSync(join(FIXTURES, fixtureName), "utf-8"));
	const diffs: Diff[] = [];
	diffStructure(captured, fixture, "root", diffs);

	if (diffs.length === 0) {
		console.log(`\n✅  ${capturedFile} ↔ ${fixtureName} — structurally identical`);
	} else {
		console.log(`\n🔍  ${capturedFile} ↔ ${fixtureName} — ${diffs.length} difference(s):`);
		for (const d of diffs) {
			if (d.type === "type_mismatch") {
				console.log(`   TYPE MISMATCH  ${d.path}  captured=${d.captured}  fixture=${d.fixture}`);
			} else if (d.type === "missing_in_fixture") {
				console.log(`   IN CAPTURED ONLY  ${d.path}  (${d.capturedType})`);
			} else {
				console.log(`   IN FIXTURE ONLY   ${d.path}  (${d.fixtureType})`);
			}
		}
	}
}
