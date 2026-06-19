/**
 * Build the local MusicBrainz gender lookup (SQLite) the worker ships in its
 * image. Input is the distilled `spotify_id,gender` CSV produced by
 * scripts/maintenance/musicbrainz-dump-gender.sh from a MusicBrainz full-export
 * dump; output is a single read-only SQLite file keyed on spotify_id.
 *
 * Regenerate when refreshing the dump:
 *   bash scripts/maintenance/musicbrainz-dump-gender.sh          # dump -> CSV
 *   bun run scripts/maintenance/build-vocal-gender-db.ts          # CSV  -> sqlite
 *
 * Gender mapping (the CSV carries MusicBrainz's raw vocabulary, which is wider
 * than our artist.gender CHECK of female/male/other):
 *   female | male        -> stored verbatim
 *   non-binary | other   -> 'other'   (a real gender, but contributes no
 *                                       female/male vocal signal downstream)
 *   not applicable       -> skipped   (groups / non-persons; left to the
 *                                       Wikidata band fallback at resolve time)
 */

import { Database } from "bun:sqlite";
import { resolve } from "node:path";

const REPO_ROOT = process.cwd();
const CSV = process.env.CSV ?? "/tmp/mbdump/mb_artist_gender.csv";
const OUT = resolve(
	REPO_ROOT,
	"src/lib/domains/enrichment/vocal-gender/data/musicbrainz-gender.sqlite",
);

function mapGender(raw: string): "female" | "male" | "other" | null {
	switch (raw) {
		case "female":
			return "female";
		case "male":
			return "male";
		case "non-binary":
		case "other":
			return "other";
		default:
			// "not applicable" / anything unexpected — no usable solo gender.
			return null;
	}
}

const csvText = await Bun.file(CSV).text();
const lines = csvText.split("\n");
if (lines[0]?.trim() !== "spotify_id,gender") {
	throw new Error(`Unexpected CSV header: ${JSON.stringify(lines[0])}`);
}

const rows: Array<[string, string]> = [];
const tally = { female: 0, male: 0, other: 0, skipped: 0 };
for (let i = 1; i < lines.length; i++) {
	const line = lines[i];
	if (!line) continue;
	const comma = line.indexOf(",");
	if (comma === -1) continue;
	const spotifyId = line.slice(0, comma);
	const gender = mapGender(line.slice(comma + 1));
	if (gender === null) {
		tally.skipped++;
		continue;
	}
	rows.push([spotifyId, gender]);
	tally[gender]++;
}

// Fresh build every time — overwrite any prior artifact so reruns are clean.
await Bun.file(OUT)
	.unlink()
	.catch(() => {});

const db = new Database(OUT, { create: true });
db.run("pragma journal_mode = delete"); // single-file, no -wal sidecar to commit
// WITHOUT ROWID: the clustered PK btree IS the table, so the 22-char Spotify id
// is stored once instead of twice (table row + separate index) — roughly halves
// the committed file for a point-lookup-only dataset.
db.run(
	"create table artist_gender (spotify_id text primary key, gender text not null) without rowid",
);
db.run("create table mb_meta (key text primary key, value text not null)");

const insert = db.prepare(
	"insert or replace into artist_gender (spotify_id, gender) values (?, ?)",
);
const insertAll = db.transaction((batch: Array<[string, string]>) => {
	for (const [sid, g] of batch) insert.run(sid, g);
});
insertAll(rows);

const meta = db.prepare("insert into mb_meta (key, value) values (?, ?)");
meta.run("source", "musicbrainz full export (spotify-linked artists with gender)");
meta.run("artists", String(rows.length));
meta.run("female", String(tally.female));
meta.run("male", String(tally.male));
meta.run("other", String(tally.other));

db.run("vacuum");
db.close();

const sizeMb = (Bun.file(OUT).size / 1_000_000).toFixed(1);
console.log(
	`built ${OUT}\n  artists: ${rows.length} (female ${tally.female} / male ${tally.male} / other ${tally.other}), skipped ${tally.skipped}\n  size: ${sizeMb} MB`,
);
