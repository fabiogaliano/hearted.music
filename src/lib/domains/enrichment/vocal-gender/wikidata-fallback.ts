/**
 * Wikidata fallback — the second hop of vocal-gender resolution, for artists the
 * local MusicBrainz dump can't gender (no Spotify link in MB, or a band, which MB
 * never genders). One batched SPARQL query per group of ids reads, for each
 * Spotify artist:
 *   - its own gender (P21)            -> a solo person the dump missed
 *   - its members' genders (P527/P463 -> P21) -> a band's vocal gender
 *
 * Solo P21 wins when present (a person has no members); otherwise the member set
 * yields band_gender. Mirrors scripts/maintenance/backfill-band-gender.ts but
 * folds in the solo case so the fallback isn't band-only.
 *
 * Network-bound but cheap: SPARQL takes a whole batch per request, so this stays
 * fast and within Wikidata's politeness expectations (unlike the 1 req/s
 * MusicBrainz API this whole system was built to stop calling).
 */

const USER_AGENT = "HeartedEnrichment/1.0 ( fbkzdev@gmail.com )";
const SPARQL = "https://query.wikidata.org/sparql";
const BATCH = 50; // ids per SPARQL query
const GAP_MS = 1000; // politeness between queries

// Gender QIDs we map to female/male; any other gendered value -> "other".
const FEMALE = new Set(["Q6581072", "Q1052281"]); // female, trans woman
const MALE = new Set(["Q6581097", "Q2449503"]); // male, trans man

export interface WikidataResolved {
	spotify_id: string;
	wikidata_id: string | null;
	/** Solo gender from the entity's own P21. */
	gender: "female" | "male" | "other" | null;
	/** Band gender inferred from member P21s. */
	band_gender: "female" | "male" | "mixed" | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const qid = (uri: string) => uri.split("/").pop() ?? "";

function classify(g: string): "female" | "male" | "other" {
	if (FEMALE.has(g)) return "female";
	if (MALE.has(g)) return "male";
	return "other";
}

interface Acc {
	wd: string;
	self: "female" | "male" | "other" | null;
	members: Set<"female" | "male">;
}

async function resolveBatch(batch: string[]): Promise<WikidataResolved[]> {
	const values = batch.map((id) => `"${id}"`).join(" ");
	const query = `
		SELECT ?sid ?artist ?selfGender ?memberGender WHERE {
			VALUES ?sid { ${values} }
			?artist wdt:P1902 ?sid .
			OPTIONAL { ?artist wdt:P21 ?selfGender. }
			OPTIONAL {
				{ ?artist wdt:P527 ?member. } UNION { ?member wdt:P463 ?artist. }
				?member wdt:P21 ?memberGender.
			}
		}`;
	const res = await fetch(
		`${SPARQL}?format=json&query=${encodeURIComponent(query)}`,
		{
			headers: {
				"User-Agent": USER_AGENT,
				Accept: "application/sparql-results+json",
			},
		},
	);
	if (!res.ok) throw new Error(`SPARQL ${res.status}`);
	const data = (await res.json()) as {
		results: { bindings: Array<Record<string, { value: string }>> };
	};

	const acc = new Map<string, Acc>();
	for (const b of data.results.bindings) {
		const sid = b.sid?.value;
		if (!sid) continue;
		const entry = acc.get(sid) ?? {
			wd: qid(b.artist.value),
			self: null,
			members: new Set(),
		};
		if (b.selfGender) entry.self = classify(qid(b.selfGender.value));
		if (b.memberGender) {
			const g = classify(qid(b.memberGender.value));
			if (g === "female" || g === "male") entry.members.add(g);
		}
		acc.set(sid, entry);
	}

	return batch.map((sid) => {
		const hit = acc.get(sid);
		if (!hit)
			return {
				spotify_id: sid,
				wikidata_id: null,
				gender: null,
				band_gender: null,
			};
		// A person's own gender takes precedence; only fall back to member-derived
		// band gender when the entity carries no P21 of its own.
		if (hit.self) {
			return {
				spotify_id: sid,
				wikidata_id: hit.wd,
				gender: hit.self,
				band_gender: null,
			};
		}
		const m = hit.members;
		const band_gender =
			m.has("female") && m.has("male")
				? "mixed"
				: m.has("female")
					? "female"
					: m.has("male")
						? "male"
						: null;
		return { spotify_id: sid, wikidata_id: hit.wd, gender: null, band_gender };
	});
}

/**
 * Resolves Spotify artist ids via Wikidata. Returns one entry per id that was
 * successfully queried (a null/null entry means "Wikidata has nothing" — a real
 * answer worth recording so we don't re-query it). Ids whose batch errored are
 * omitted entirely, so a later run retries them rather than marking them checked.
 */
export async function resolveWikidataGenders(
	spotifyIds: string[],
): Promise<WikidataResolved[]> {
	const ids = [...new Set(spotifyIds)];
	const resolved: WikidataResolved[] = [];
	for (let i = 0; i < ids.length; i += BATCH) {
		const batch = ids.slice(i, i + BATCH);
		try {
			resolved.push(...(await resolveBatch(batch)));
		} catch (err) {
			console.warn(
				`vocal-gender wikidata batch ${i} failed: ${err instanceof Error ? err.message : err}`,
			);
		}
		if (i + BATCH < ids.length) await sleep(GAP_MS);
	}
	return resolved;
}
