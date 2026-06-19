/**
 * Backfill artist.band_gender from Wikidata band membership.
 *
 * For artists MusicBrainz couldn't gender (gender is null after an MB check —
 * i.e. groups and unlinked entries), resolve the Spotify id to a Wikidata entity
 * (P1902), walk its members (P527 "has part" / P463 "member of"), read each
 * member's gender (P21), and record band_gender: female (all female), male (all
 * male), or mixed (both).
 *
 * Caveat: trust this less than a solo artist's gender. Wikidata member lists are
 * often incomplete/instrumentalist-skewed, so a band's vocalist can be missing
 * (e.g. Margaret Island reads "male" off its lone listed drummer despite a female
 * lead). Single-member labels are the weak ones.
 *
 * Unlike MusicBrainz, Wikidata's SPARQL endpoint takes a batch of ids per query,
 * so this resolves the whole group set in minutes, not hours.
 *
 * Idempotent + resumable via wikidata_checked_at. Targets only MB-confirmed nulls
 * (musicbrainz_checked_at is not null) so it never races the MB backfill. Run it
 * after, or alongside — rerunning picks up newly-confirmed nulls.
 *
 * Usage:
 *   bun run scripts/maintenance/backfill-band-gender.ts            # full run
 *   bun run scripts/maintenance/backfill-band-gender.ts --limit 60 # smoke test
 *   bun run scripts/maintenance/backfill-band-gender.ts --dry-run  # no prod writes
 */

import { resolve } from "node:path";

const REPO_ROOT = process.cwd();
const PROD_TOOL = resolve(REPO_ROOT, "scripts/db/prod.ts");

const USER_AGENT = "HeartedEnrichment/1.0 ( fbkzdev@gmail.com )";
const SPARQL = "https://query.wikidata.org/sparql";
const BATCH = 50; // ids per SPARQL query
const GAP_MS = 1000; // politeness between queries

// Wikidata gender QIDs we treat as female/male; anything else counts as neither
// (so a band with a non-binary member can't be "all one gender" -> stays null).
const FEMALE = new Set(["Q6581072", "Q1052281"]); // female, trans woman
const MALE = new Set(["Q6581097", "Q2449503"]); // male, trans man

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const limitArg = args.indexOf("--limit") !== -1 ? args[args.indexOf("--limit") + 1] : null;
const LIMIT = limitArg ? Number(limitArg) : null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Artist {
	spotify_id: string;
	name: string;
}
interface Resolved {
	spotify_id: string;
	wikidata_id: string | null;
	band_gender: "female" | "male" | "mixed" | null;
}

async function prodSql(sql: string, opts: { write?: boolean } = {}): Promise<unknown> {
	const proc = Bun.spawn(
		["bun", PROD_TOOL, "sql", ...(opts.write ? ["--write", "--yes"] : []), "--json", sql],
		{ cwd: REPO_ROOT, stdout: "pipe", stderr: "inherit" },
	);
	const out = await new Response(proc.stdout).text();
	if ((await proc.exited) !== 0) throw new Error("prod:sql failed");
	const t = out.trim();
	return t ? JSON.parse(t) : [];
}

const qid = (uri: string) => uri.split("/").pop() ?? "";

/** One SPARQL query for a batch of Spotify ids -> per-id band gender. */
async function resolveBatch(batch: Artist[]): Promise<Resolved[]> {
	const values = batch.map((a) => `"${a.spotify_id}"`).join(" ");
	const query = `
		SELECT ?sid ?artist ?gender WHERE {
			VALUES ?sid { ${values} }
			?artist wdt:P1902 ?sid .
			OPTIONAL {
				{ ?artist wdt:P527 ?member. } UNION { ?member wdt:P463 ?artist. }
				?member wdt:P21 ?gender.
			}
		}`;
	const res = await fetch(`${SPARQL}?format=json&query=${encodeURIComponent(query)}`, {
		headers: { "User-Agent": USER_AGENT, Accept: "application/sparql-results+json" },
	});
	if (!res.ok) throw new Error(`SPARQL ${res.status}`);
	const data = (await res.json()) as {
		results: { bindings: Array<Record<string, { value: string }>> };
	};

	// Per sid: the Wikidata entity, and the set of member genders seen.
	const acc = new Map<string, { wd: string; genders: Set<string> }>();
	for (const b of data.results.bindings) {
		const sid = b.sid?.value;
		if (!sid) continue;
		const entry = acc.get(sid) ?? { wd: qid(b.artist.value), genders: new Set<string>() };
		if (b.gender) {
			const g = qid(b.gender.value);
			if (FEMALE.has(g)) entry.genders.add("female");
			else if (MALE.has(g)) entry.genders.add("male");
		}
		acc.set(sid, entry);
	}

	return batch.map((a) => {
		const hit = acc.get(a.spotify_id);
		if (!hit) return { spotify_id: a.spotify_id, wikidata_id: null, band_gender: null };
		const g = hit.genders;
		const band_gender: Resolved["band_gender"] =
			g.has("female") && g.has("male")
				? "mixed"
				: g.has("female")
					? "female"
					: g.has("male")
						? "male"
						: null;
		return { spotify_id: a.spotify_id, wikidata_id: hit.wd, band_gender };
	});
}

function lit(v: string | null): string {
	return v === null ? "null::text" : `'${v.replace(/'/g, "''")}'::text`;
}

async function flush(rows: Resolved[]): Promise<void> {
	if (rows.length === 0) return;
	const values = rows
		.map((r) => `(${lit(r.spotify_id)}, ${lit(r.band_gender)}, ${lit(r.wikidata_id)})`)
		.join(",\n");
	const sql = `
		update artist as a set
			band_gender = v.band_gender,
			wikidata_id = v.wikidata_id,
			wikidata_checked_at = now()
		from (values
			${values}
		) as v(spotify_id, band_gender, wikidata_id)
		where a.spotify_id = v.spotify_id;`;
	if (dryRun) {
		console.log(`  [dry-run] would flush ${rows.length} rows`);
		return;
	}
	await prodSql(sql, { write: true });
}

async function main() {
	const pending = (await prodSql(
		`select spotify_id, name from artist
		 where gender is null and musicbrainz_checked_at is not null and wikidata_checked_at is null
		 order by spotify_id${LIMIT ? ` limit ${LIMIT}` : ""}`,
	)) as Artist[];

	console.log(`Wikidata band-gender for ${pending.length} artist(s)${dryRun ? " [DRY RUN]" : ""}`);
	if (pending.length === 0) return;

	const tally = { female: 0, male: 0, mixed: 0, in_wd: 0 };
	for (let i = 0; i < pending.length; i += BATCH) {
		const batch = pending.slice(i, i + BATCH);
		let resolved: Resolved[];
		try {
			resolved = await resolveBatch(batch);
		} catch (err) {
			console.error(`  ! batch ${i}: ${err instanceof Error ? err.message : err}`);
			await sleep(GAP_MS * 3);
			continue; // leave unchecked -> a rerun retries this batch
		}
		for (const r of resolved) {
			if (r.wikidata_id) tally.in_wd++;
			if (r.band_gender === "female") tally.female++;
			else if (r.band_gender === "male") tally.male++;
			else if (r.band_gender === "mixed") tally.mixed++;
		}
		await flush(resolved);
		console.log(
			`  ${Math.min(i + BATCH, pending.length)}/${pending.length}  (band f:${tally.female} m:${tally.male} mixed:${tally.mixed}, in-wikidata:${tally.in_wd})`,
		);
		await sleep(GAP_MS);
	}

	console.log(`\nDone. bands — female:${tally.female} male:${tally.male} mixed:${tally.mixed}`);
	if (!dryRun) {
		const r = (await prodSql("select refresh_song_vocal_gender() as n", {
			write: true,
		})) as Array<{ n: number }>;
		console.log(`Refreshed song.vocal_gender: ${r[0]?.n ?? 0} songs changed.`);
	}
}

await main();
