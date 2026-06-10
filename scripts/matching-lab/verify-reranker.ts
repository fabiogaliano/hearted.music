/**
 * DeepInfra Reranker Contract Probe — Tasks 0.1 + 0.2
 *
 * Probes the live DeepInfra Qwen3-Reranker-0.6B endpoint to establish the
 * TRUE request/response contract. The current integration uses a Cohere/Jina
 * body shape that likely never worked. This script tries all candidate shapes
 * and runs black-box sanity checks against whichever succeeds.
 *
 * Three candidate shapes are tested:
 *   Shape A — current production code (Cohere/Jina): {query, documents, return_documents}
 *   Shape B — documented on Qwen3 model page:        {queries: string[], documents: string[]}
 *   Shape C — documented on generic /apis/reranker:  {query, documents}  (singular, no return_documents)
 *
 * From DeepInfra's embedded page schema (retrieved 2026-06-10):
 *   Input: queries (array, required?), documents (array, required?), instruction (string, optional)
 *   "It should have the same length as documents" — PAIRWISE indicator
 *   Output: { scores: number[], input_tokens: integer, request_id?: string, inference_status: {...} }
 *
 * Usage:
 *   bun scripts/matching-lab/verify-reranker.ts --key=<DEEPINFRA_API_KEY>
 *   # or: DEEPINFRA_API_KEY=xxx bun scripts/matching-lab/verify-reranker.ts
 *
 * PROBE ONLY — reads no src/ files, writes no src/ files.
 */

import { createLocalLabClient, selectAll } from "./shared";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const RERANKER_URL =
	"https://api.deepinfra.com/v1/inference/Qwen/Qwen3-Reranker-0.6B";

// ---------------------------------------------------------------------------
// API key resolution — CLI arg takes priority, then env
// ---------------------------------------------------------------------------

function resolveApiKey(): string | null {
	const args = process.argv.slice(2);
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg.startsWith("--key=")) return arg.slice("--key=".length).trim();
		if (arg === "--key" && args[i + 1]) return args[i + 1].trim();
	}
	return process.env.DEEPINFRA_API_KEY ?? null;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

interface ProbeResult {
	status: number;
	body: unknown;
	ok: boolean;
	error?: string;
}

async function callEndpoint(
	apiKey: string,
	payload: unknown,
	label: string,
): Promise<ProbeResult> {
	console.log(`\n${"─".repeat(60)}`);
	console.log(`PROBE: ${label}`);
	console.log("Request body:");
	console.log(JSON.stringify(payload, null, 2));

	try {
		const resp = await fetch(RERANKER_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify(payload),
			signal: AbortSignal.timeout(30_000),
		});

		let body: unknown;
		try {
			body = await resp.json();
		} catch {
			body = { _raw: await resp.text().catch(() => "(unreadable)") };
		}

		console.log(`\nHTTP Status: ${resp.status}`);
		console.log("Response body:");
		console.log(JSON.stringify(body, null, 2));

		return { status: resp.status, body, ok: resp.ok };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.log(`\nFetch error: ${msg}`);
		return { status: 0, body: null, ok: false, error: msg };
	}
}

// ---------------------------------------------------------------------------
// Shape A — current production code (Cohere/Jina style)
// { query, documents, return_documents }
// ---------------------------------------------------------------------------

async function probeShapeA(apiKey: string): Promise<ProbeResult> {
	return callEndpoint(
		apiKey,
		{
			query: "upbeat house music for dancing",
			documents: [
				"Never Gonna Give You Up by Rick Astley. Genres: pop, 80s pop.",
				"Around The World by Daft Punk. Genres: house, electronic, dance.",
				"Classical Symphony No. 5 by Beethoven. Genres: classical, orchestral.",
			],
			return_documents: false,
		},
		"Shape A — current production body (Cohere/Jina: {query, documents, return_documents})",
	);
}

// ---------------------------------------------------------------------------
// Shape B — documented on Qwen3-Reranker-0.6B model page
// { queries: string[], documents: string[] } — parallel arrays, pairwise
// ---------------------------------------------------------------------------

async function probeShapeB(apiKey: string): Promise<ProbeResult> {
	return callEndpoint(
		apiKey,
		{
			queries: [
				"upbeat house music for dancing",
				"upbeat house music for dancing",
				"upbeat house music for dancing",
			],
			documents: [
				"Never Gonna Give You Up by Rick Astley. Genres: pop, 80s pop.",
				"Around The World by Daft Punk. Genres: house, electronic, dance.",
				"Classical Symphony No. 5 by Beethoven. Genres: classical, orchestral.",
			],
		},
		"Shape B — model page contract ({queries: [], documents: []})",
	);
}

// ---------------------------------------------------------------------------
// Shape C — documented on generic /apis/reranker page
// { query: string, documents: string[] } — singular query, no return_documents
// ---------------------------------------------------------------------------

async function probeShapeC(apiKey: string): Promise<ProbeResult> {
	return callEndpoint(
		apiKey,
		{
			query: "upbeat house music for dancing",
			documents: [
				"Never Gonna Give You Up by Rick Astley. Genres: pop, 80s pop.",
				"Around The World by Daft Punk. Genres: house, electronic, dance.",
				"Classical Symphony No. 5 by Beethoven. Genres: classical, orchestral.",
			],
		},
		"Shape C — generic reranker docs ({query: string, documents: []})",
	);
}

// ---------------------------------------------------------------------------
// Also test with instruction field (Task 2.3 probe)
// ---------------------------------------------------------------------------

async function probeWithInstruction(apiKey: string): Promise<ProbeResult> {
	return callEndpoint(
		apiKey,
		{
			queries: [
				"upbeat house music for dancing",
				"upbeat house music for dancing",
			],
			documents: [
				"Around The World by Daft Punk. Genres: house, electronic, dance.",
				"Classical Symphony No. 5 by Beethoven. Genres: classical, orchestral.",
			],
			instruction:
				"Given a playlist's mood and theme, judge if this song belongs in it.",
		},
		"Shape B + instruction field (Task 2.3 check)",
	);
}

// ---------------------------------------------------------------------------
// Score extraction — tries both response shapes
// ---------------------------------------------------------------------------

interface Scores {
	values: number[];
	raw: unknown;
}

function extractScores(body: unknown): Scores | null {
	if (!body || typeof body !== "object") return null;
	const b = body as Record<string, unknown>;

	// Shape B/C response: { scores: number[] }
	if (Array.isArray(b.scores)) {
		return { values: b.scores as number[], raw: b.scores };
	}

	// Shape A response (Cohere): { results: [{index, relevance_score}] }
	if (Array.isArray(b.results)) {
		const arr = b.results as Array<Record<string, unknown>>;
		if (arr.length > 0 && "relevance_score" in arr[0]) {
			const scores = arr
				.sort((a, b) => ((a.index as number) ?? 0) - ((b.index as number) ?? 0))
				.map((r) => r.relevance_score as number);
			return { values: scores, raw: arr };
		}
	}

	return null;
}

// ---------------------------------------------------------------------------
// Sanity check helpers
// ---------------------------------------------------------------------------

function pass(condition: boolean): string {
	return condition ? "✓ PASS" : "✗ FAIL";
}

function quartiles(values: number[]): {
	min: number;
	q1: number;
	median: number;
	q3: number;
	max: number;
	mean: number;
} {
	const sorted = [...values].sort((a, b) => a - b);
	const n = sorted.length;
	const mean = sorted.reduce((s, v) => s + v, 0) / n;
	const q1 = sorted[Math.floor(n * 0.25)];
	const median = sorted[Math.floor(n * 0.5)];
	const q3 = sorted[Math.floor(n * 0.75)];
	return { min: sorted[0], q1, median, q3, max: sorted[n - 1], mean };
}

type WorkingShape = "A" | "B" | "C";

// ---------------------------------------------------------------------------
// Sanity Check 1: Inversion
// ---------------------------------------------------------------------------

async function checkInversion(
	apiKey: string,
	workingShape: WorkingShape,
): Promise<void> {
	console.log(`\n${"═".repeat(60)}`);
	console.log("SANITY CHECK 1 — Inversion");
	console.log("Expected: verbatim-match score > 0.9, unrelated score < 0.2");

	const query = "upbeat house music for dancing with 4/4 beat and synthesizers";

	let payload: unknown;
	if (workingShape === "B") {
		payload = {
			queries: [query, query],
			documents: [
				query, // verbatim match
				"How to bake sourdough bread: mix flour, water, starter, and salt.",
			],
		};
	} else {
		// Shape A or C: singular query
		payload = {
			query,
			documents: [
				query,
				"How to bake sourdough bread: mix flour, water, starter, and salt.",
			],
			...(workingShape === "A" ? { return_documents: false } : {}),
		};
	}

	const result = await callEndpoint(apiKey, payload, "Inversion check");
	const scores = extractScores(result.body);

	if (!scores || scores.values.length < 2) {
		console.log("ERROR: Could not extract scores for inversion check");
		return;
	}

	const [verbatimScore, unrelatedScore] = scores.values;
	console.log(`\nVerbatim-match score:  ${verbatimScore?.toFixed(4)}`);
	console.log(`Unrelated-topic score: ${unrelatedScore?.toFixed(4)}`);
	console.log(`Verbatim > 0.9: ${pass((verbatimScore ?? 0) > 0.9)}`);
	console.log(`Unrelated < 0.2: ${pass((unrelatedScore ?? 1) < 0.2)}`);
}

// ---------------------------------------------------------------------------
// Sanity Check 2: Monotonicity
// ---------------------------------------------------------------------------

async function checkMonotonicity(
	apiKey: string,
	workingShape: WorkingShape,
): Promise<void> {
	console.log(`\n${"═".repeat(60)}`);
	console.log("SANITY CHECK 2 — Monotonicity");
	console.log(
		"Expected: 3 docs of strictly decreasing relevance → strictly decreasing scores",
	);

	const query = "chill lo-fi hip hop playlist for studying at night";
	const docs = [
		"Lo-Fi Study Beats Vol. 3 by ChilledCow. Genres: lo-fi hip hop, chillhop, ambient. Slow BPM, mellow jazz samples, relaxed late-night vibes.",
		"HUMBLE. by Kendrick Lamar. Genres: hip hop, trap, rap. Aggressive energy, hard-hitting beats, lyrical intensity.",
		"Bohemian Rhapsody by Queen. Genres: rock, progressive rock, classic rock. Theatrical operatic vocals, electric guitar solos.",
	];

	let payload: unknown;
	if (workingShape === "B") {
		payload = {
			queries: [query, query, query],
			documents: docs,
		};
	} else {
		payload = {
			query,
			documents: docs,
			...(workingShape === "A" ? { return_documents: false } : {}),
		};
	}

	const result = await callEndpoint(apiKey, payload, "Monotonicity check");
	const scores = extractScores(result.body);

	if (!scores || scores.values.length < 3) {
		console.log("ERROR: Could not extract 3 scores for monotonicity check");
		return;
	}

	const [high, mid, low] = scores.values;
	console.log(`\nHigh-relevance score:  ${high?.toFixed(4)}`);
	console.log(`Mid-relevance score:   ${mid?.toFixed(4)}`);
	console.log(`Low-relevance score:   ${low?.toFixed(4)}`);
	const isMonotone = (high ?? 0) > (mid ?? 0) && (mid ?? 0) > (low ?? 0);
	console.log(`Strictly decreasing: ${pass(isMonotone)}`);
}

// ---------------------------------------------------------------------------
// Sanity Check 3: Pairwise semantics (only meaningful for Shape B)
// ---------------------------------------------------------------------------

async function checkPairwiseSemantics(
	apiKey: string,
	workingShape: WorkingShape,
): Promise<void> {
	console.log(`\n${"═".repeat(60)}`);
	console.log("SANITY CHECK 3 — Pairwise semantics discriminator (CRITICAL)");
	console.log(
		"From schema docs: queries 'should have the same length as documents'",
	);

	if (workingShape !== "B") {
		console.log(
			`Working shape is ${workingShape} (single query → N docs), not pairwise Shape B.`,
		);
		console.log(
			"Task 0.3: send a single query, parse scores[i] positionally.",
		);
		return;
	}

	// Test: cross-matched queries
	// q1 = house, q2 = classical; d1 = house, d2 = classical
	// If PAIRWISE: both scores high
	// If SINGLE-QUERY (only queries[0] used): score[0] high, score[1] low
	const q1 = "upbeat electronic house music for dancing";
	const q2 = "classical orchestral concert music for a formal event";
	const d1 =
		"Around The World by Daft Punk. Genres: house, electronic, techno. 4/4 beat, driving synths, danceable.";
	const d2 =
		"Symphony No. 9 by Beethoven. Genres: classical, orchestral, romantic era. Full orchestra, choral finale.";

	console.log("\n--- Cross-matched queries test ---");
	console.log(
		"queries=[house_q, classical_q], docs=[house_doc, classical_doc]",
	);
	console.log(
		"Pairwise → both scores high; single-query → house_doc high only",
	);

	const crossResult = await callEndpoint(
		apiKey,
		{ queries: [q1, q2], documents: [d1, d2] },
		"Pairwise discriminator — cross-matched queries",
	);
	const crossScores = extractScores(crossResult.body);

	if (crossScores && crossScores.values.length >= 2) {
		const [s1, s2] = crossScores.values;
		console.log(`\nScore for (house_query, house_doc):      ${s1?.toFixed(4)}`);
		console.log(`Score for (classical_query, classical_doc): ${s2?.toFixed(4)}`);
		console.log(
			`Both > 0.5 → PAIRWISE: ${pass((s1 ?? 0) > 0.5 && (s2 ?? 0) > 0.5)}`,
		);
		console.log(
			`s1 high && s2 low → SINGLE-QUERY: ${pass((s1 ?? 0) > 0.5 && (s2 ?? 0) < 0.3)}`,
		);

		if ((s1 ?? 0) > 0.5 && (s2 ?? 0) > 0.5) {
			console.log(
				"\n→ VERDICT: PAIRWISE — queries[i] scores against documents[i]",
			);
			console.log(
				"  Task 0.3: repeat query N times: queries = Array(docs.length).fill(query)",
			);
		} else if ((s1 ?? 0) > 0.5 && (s2 ?? 0) < 0.3) {
			console.log(
				"\n→ VERDICT: SINGLE-QUERY — only queries[0] used for all documents",
			);
			console.log(
				"  Task 0.3: send queries=[query] (single element)",
			);
		} else {
			console.log(
				`\n→ VERDICT AMBIGUOUS — scores [${s1?.toFixed(4)}, ${s2?.toFixed(4)}]`,
			);
		}
	}

	// Baseline test: same query, one matched doc, one not
	console.log("\n--- Same-query baseline ---");
	const sameQueryResult = await callEndpoint(
		apiKey,
		{ queries: [q1, q1], documents: [d1, d2] },
		"Pairwise discriminator — same query baseline",
	);
	const sameScores = extractScores(sameQueryResult.body);
	if (sameScores && sameScores.values.length >= 2) {
		const [s1, s2] = sameScores.values;
		console.log(
			`\nScore for (house_query, house_doc):      ${s1?.toFixed(4)}`,
		);
		console.log(
			`Score for (house_query, classical_doc):  ${s2?.toFixed(4)}`,
		);
		console.log(
			`house > classical: ${pass((s1 ?? 0) > (s2 ?? 1))} (expected yes for both semantics)`,
		);
	}
}

// ---------------------------------------------------------------------------
// Sanity Check 4: Distribution over real (or fallback) data
// ---------------------------------------------------------------------------

async function checkDistribution(
	apiKey: string,
	workingShape: WorkingShape,
): Promise<void> {
	console.log(`\n${"═".repeat(60)}`);
	console.log("SANITY CHECK 4 — Score distribution over real local data");

	let pairs: Array<{ query: string; doc: string; label: string }> = [];
	let usedRealData = false;

	try {
		const client = createLocalLabClient();

		const [playlists, songs, analyses] = await Promise.all([
			selectAll<{ id: string; name: string; description: string | null }>(
				client,
				"playlist",
				"id, name, description",
			),
			selectAll<{
				id: string;
				name: string;
				artists: string[];
				genres: string[];
			}>(client, "song", "id, name, artists, genres", 500),
			selectAll<{ song_id: string; analysis: Record<string, unknown> }>(
				client,
				"song_analysis",
				"song_id, analysis",
			),
		]);

		if (playlists.length === 0 || songs.length === 0) {
			throw new Error("No playlists or songs in local DB");
		}

		const analysisMap = new Map<string, string>();
		for (const a of analyses) {
			try {
				const ana = a.analysis as Record<string, unknown>;
				const parts: string[] = [];
				// Dominant schema (75/92): arc, take, tension, texture
				if (typeof ana.take === "string") {
					parts.push(ana.take.slice(0, 400));
				}
				if (typeof ana.tension === "string") {
					parts.push(`Tension: ${ana.tension}`);
				}
				if (ana.arc && Array.isArray(ana.arc)) {
					const arcMoods = (ana.arc as Array<{ mood: string }>)
						.slice(0, 3)
						.map((s) => s.mood)
						.join(", ");
					parts.push(`Arc: ${arcMoods}`);
				}
				if (typeof ana.texture === "string") {
					parts.push(`Texture: ${ana.texture.slice(0, 200)}`);
				}
				// Minority schema (17/92): mood_description, compound_mood
				if (typeof ana.mood_description === "string") {
					parts.push(ana.mood_description.slice(0, 200));
				}
				// Rarest schema (8/92): themes
				if (ana.themes && Array.isArray(ana.themes)) {
					const themes = (
						ana.themes as Array<{ name: string; description: string }>
					)
						.slice(0, 3)
						.map((t) => `${t.name}: ${t.description}`)
						.join("; ");
					parts.push(`Themes: ${themes}`);
				}
				if (parts.length > 0) {
					analysisMap.set(a.song_id, parts.join(". ").slice(0, 1600));
				}
			} catch {
				// skip malformed analysis
			}
		}

		const targetPairs = 50;
		const songsPerPlaylist = Math.ceil(targetPairs / Math.max(playlists.length, 1));

		for (const playlist of playlists) {
			if (pairs.length >= targetPairs) break;
			const query = playlist.description
				? `${playlist.name}. ${playlist.description}`
				: playlist.name;
			const step = Math.max(1, Math.floor(songs.length / songsPerPlaylist));
			const sampled = songs
				.filter((_, i) => i % step === 0)
				.slice(0, songsPerPlaylist);
			for (const song of sampled) {
				if (pairs.length >= targetPairs) break;
				const artistStr = song.artists.join(", ");
				const genreStr = song.genres.join(", ");
				let doc = `${song.name} by ${artistStr}. Genres: ${genreStr}.`;
				const analysis = analysisMap.get(song.id);
				if (analysis) doc += ` ${analysis}`;
				pairs.push({
					query,
					doc,
					label: `${playlist.name.slice(0, 30)} × ${song.name.slice(0, 30)}`,
				});
			}
		}

		usedRealData = true;
		console.log(
			`\nLoaded ${playlists.length} playlists, ${songs.length} songs, ${analyses.length} analyses`,
		);
		console.log(`Built ${pairs.length} real (playlist, song) pairs`);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.log(`\nWARNING: Could not load real data (${msg})`);
		console.log("FALLING BACK TO HAND-WRITTEN PAIRS (12 pairs)");
		usedRealData = false;

		const handwritten = [
			{
				query: "Chill lo-fi beats for late night studying",
				docs: [
					"Snowfall by Øneheart. Genres: lo-fi, ambient, chillwave. Slow BPM, soft piano, atmospheric textures.",
					"Montero by Lil Nas X. Genres: pop, hip hop, trap. High energy, provocative lyrics, punchy production.",
					"Breathe by Télépopmusik. Genres: trip hop, downtempo, electronic. Languid, dreamy, hypnotic vocals.",
					"Savage by Megan Thee Stallion. Genres: trap, hip hop. Aggressive, high BPM, club-ready.",
				],
			},
			{
				query: "Upbeat 90s hip hop throwbacks",
				docs: [
					"C.R.E.A.M. by Wu-Tang Clan. Genres: hip hop, east coast rap. Classic sample flip, raw lyricism.",
					"Twinkle Twinkle Little Star. Genres: nursery rhyme, children's music. Simple melody.",
					"Nuthin But A G Thang by Dr. Dre feat. Snoop Dogg. Genres: west coast hip hop, gangsta rap.",
					"Symphony No. 9 by Beethoven. Genres: classical, romantic era, orchestral.",
				],
			},
			{
				query: "House music for a late night club set",
				docs: [
					"Strings of Life by Derrick May. Genres: Detroit techno, house, electronic. Iconic piano stabs.",
					"Country Roads by John Denver. Genres: country, folk. Acoustic guitar, wholesome American imagery.",
					"French Kiss by Lil Louis. Genres: house, Chicago house. Hypnotic groove, late-night feel.",
				],
			},
		];
		for (const group of handwritten) {
			for (const doc of group.docs) {
				pairs.push({
					query: group.query,
					doc,
					label: `${group.query.slice(0, 20)} × ${doc.slice(0, 20)}`,
				});
			}
		}
	}

	console.log(
		`\nSending ${pairs.length} pairs to DeepInfra (Shape ${workingShape})...`,
	);

	let allScores: number[] = [];

	if (workingShape === "B") {
		// Shape B: one big batch, queries parallel to documents
		const payload = {
			queries: pairs.map((p) => p.query),
			documents: pairs.map((p) => p.doc),
		};
		const resp = await fetch(RERANKER_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify(payload),
			signal: AbortSignal.timeout(60_000),
		});
		const body = (await resp.json()) as Record<string, unknown>;
		console.log(`HTTP ${resp.status}`);
		if (resp.ok && Array.isArray(body.scores)) {
			allScores = body.scores as number[];
		} else {
			console.log(
				"Distribution batch failed:",
				JSON.stringify(body).slice(0, 300),
			);
		}
	} else {
		// Shape A or C: one call per unique query group
		const byQuery = new Map<string, { docs: string[]; indices: number[] }>();
		for (let i = 0; i < pairs.length; i++) {
			const p = pairs[i];
			if (!byQuery.has(p.query)) byQuery.set(p.query, { docs: [], indices: [] });
			const grp = byQuery.get(p.query)!;
			grp.docs.push(p.doc);
			grp.indices.push(i);
		}
		allScores = new Array(pairs.length).fill(0);
		for (const [q, { docs, indices }] of byQuery.entries()) {
			const payload =
				workingShape === "A"
					? { query: q, documents: docs, return_documents: false }
					: { query: q, documents: docs };
			const resp = await fetch(RERANKER_URL, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiKey}`,
				},
				body: JSON.stringify(payload),
				signal: AbortSignal.timeout(30_000),
			});
			const body = (await resp.json()) as Record<string, unknown>;
			if (resp.ok) {
				const scores = extractScores(body);
				if (scores) {
					for (let i = 0; i < indices.length; i++) {
						allScores[indices[i]] = scores.values[i] ?? 0;
					}
				}
			}
		}
	}

	if (allScores.length === 0) {
		console.log("No scores collected — distribution check skipped");
		return;
	}

	const stats = quartiles(allScores);
	const spread = stats.max - stats.min;

	console.log(`\nDistribution over ${allScores.length} pairs:`);
	console.log(
		`  Data source:  ${usedRealData ? "REAL local DB (Supabase)" : "HAND-WRITTEN FALLBACK (12 pairs)"}`,
	);
	console.log(`  Min:          ${stats.min.toFixed(4)}`);
	console.log(`  Q1:           ${stats.q1.toFixed(4)}`);
	console.log(`  Median:       ${stats.median.toFixed(4)}`);
	console.log(`  Mean:         ${stats.mean.toFixed(4)}`);
	console.log(`  Q3:           ${stats.q3.toFixed(4)}`);
	console.log(`  Max:          ${stats.max.toFixed(4)}`);
	console.log(`  Spread:       ${spread.toFixed(4)}`);
	console.log(
		`  Spread 0.05–0.95 expected: ${pass(stats.min < 0.2 && stats.max > 0.7)}`,
	);
	console.log(
		`  NOT clustered at ~0.5: ${pass(Math.abs(stats.mean - 0.5) > 0.1 || spread > 0.5)}`,
	);

	const indexed = allScores.map((s, i) => ({
		score: s,
		label: pairs[i]?.label ?? `pair-${i}`,
	}));
	indexed.sort((a, b) => b.score - a.score);
	console.log("\nTop 5 highest-scoring pairs:");
	for (const { score, label } of indexed.slice(0, 5)) {
		console.log(`  ${score.toFixed(4)}  ${label}`);
	}
	console.log("Top 5 lowest-scoring pairs:");
	for (const { score, label } of indexed.slice(-5).reverse()) {
		console.log(`  ${score.toFixed(4)}  ${label}`);
	}
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	console.log("╔══════════════════════════════════════════════════════════╗");
	console.log("║  DeepInfra Reranker Contract Probe — Tasks 0.1 + 0.2    ║");
	console.log("╚══════════════════════════════════════════════════════════╝");
	console.log(`Endpoint: ${RERANKER_URL}`);
	console.log(`Date: ${new Date().toISOString()}`);
	console.log(`
Documentation research (pre-run):
  Model page contract:  { queries: string[], documents: string[] }  → { scores: number[] }
  Generic reranker doc: { query: string, documents: string[] }      → { scores: number[] }
  Schema note: "queries should have the same length as documents" (pairwise indicator)
  Optional: instruction field (default: "Given a web search query, retrieve relevant passages...")
  Current code sends: { query, documents, return_documents, top_n } → parses results[].relevance_score
`);

	const apiKey = resolveApiKey();
	if (!apiKey) {
		console.error(
			"\nERROR: DEEPINFRA_API_KEY not found.\n" +
				"Pass it as: --key=YOUR_KEY  or  set DEEPINFRA_API_KEY env var.\n" +
				"The key is not in .env (all entries are placeholder comments).",
		);
		process.exit(1);
	}
	console.log(
		`API key: ${apiKey.slice(0, 6)}...${apiKey.slice(-4)} (${apiKey.length} chars)`,
	);

	// ─── Task 0.1: Shape probes ───────────────────────────────────────────

	console.log(`\n${"═".repeat(60)}`);
	console.log("TASK 0.1 — Live contract probe (3 shapes in parallel)");

	const [resultA, resultB, resultC] = await Promise.all([
		probeShapeA(apiKey),
		probeShapeB(apiKey),
		probeShapeC(apiKey),
	]);

	// Also probe instruction field
	const resultBInstruction = await probeWithInstruction(apiKey);

	// Determine working shapes
	const scoresA = extractScores(resultA.body);
	const scoresB = extractScores(resultB.body);
	const scoresC = extractScores(resultC.body);
	const scoresBInstr = extractScores(resultBInstruction.body);

	const shapeAWorks = resultA.ok && scoresA !== null && scoresA.values.length > 0;
	const shapeBWorks = resultB.ok && scoresB !== null && scoresB.values.length > 0;
	const shapeCWorks = resultC.ok && scoresC !== null && scoresC.values.length > 0;
	const instrWorks =
		resultBInstruction.ok &&
		scoresBInstr !== null &&
		scoresBInstr.values.length > 0;

	console.log(`\n${"═".repeat(60)}`);
	console.log("SHAPE PROBE SUMMARY:");

	const allBodyFields = (body: unknown) =>
		body && typeof body === "object"
			? Object.keys(body as Record<string, unknown>).join(", ")
			: "null";

	console.log(
		`Shape A ({query, documents, return_documents}): HTTP ${resultA.status} — ${shapeAWorks ? "✓ WORKS" : "✗ FAILED"}`,
	);
	if (shapeAWorks && scoresA)
		console.log(`  scores: [${scoresA.values.map((s) => s.toFixed(4)).join(", ")}]`);
	else if (resultA.ok)
		console.log(
			`  HTTP OK but no extractable scores. Fields: ${allBodyFields(resultA.body)}`,
		);

	console.log(
		`Shape B ({queries: [], documents: []}):          HTTP ${resultB.status} — ${shapeBWorks ? "✓ WORKS" : "✗ FAILED"}`,
	);
	if (shapeBWorks && scoresB) {
		console.log(`  scores: [${scoresB.values.map((s) => s.toFixed(4)).join(", ")}]`);
		console.log(`  response fields: ${allBodyFields(resultB.body)}`);
	} else if (resultB.ok)
		console.log(
			`  HTTP OK but no extractable scores. Fields: ${allBodyFields(resultB.body)}`,
		);

	console.log(
		`Shape C ({query, documents} no return_docs):     HTTP ${resultC.status} — ${shapeCWorks ? "✓ WORKS" : "✗ FAILED"}`,
	);
	if (shapeCWorks && scoresC)
		console.log(`  scores: [${scoresC.values.map((s) => s.toFixed(4)).join(", ")}]`);
	else if (resultC.ok)
		console.log(
			`  HTTP OK but no extractable scores. Fields: ${allBodyFields(resultC.body)}`,
		);

	console.log(
		`Shape B + instruction:                           HTTP ${resultBInstruction.status} — ${instrWorks ? "✓ WORKS" : "✗ FAILED"}`,
	);
	if (instrWorks && scoresBInstr)
		console.log(
			`  scores: [${scoresBInstr.values.map((s) => s.toFixed(4)).join(", ")}]`,
		);

	// Pick the working shape with highest priority (B > C > A)
	let workingShape: WorkingShape | null = null;
	if (shapeBWorks) workingShape = "B";
	else if (shapeCWorks) workingShape = "C";
	else if (shapeAWorks) workingShape = "A";

	if (!workingShape) {
		console.log(
			"\nFATAL: No shape returned usable scores. Cannot proceed with sanity checks.",
		);
		process.exit(1);
	}

	console.log(`\n→ WORKING SHAPE: ${workingShape}`);

	// ─── Task 0.2: Sanity checks ─────────────────────────────────────────

	console.log(`\n${"═".repeat(60)}`);
	console.log("TASK 0.2 — Black-box sanity checks");

	await checkInversion(apiKey, workingShape);
	await checkMonotonicity(apiKey, workingShape);
	await checkPairwiseSemantics(apiKey, workingShape);
	await checkDistribution(apiKey, workingShape);

	// ─── Final summary ───────────────────────────────────────────────────

	console.log(`\n${"╔".padEnd(61, "═")}╗`);
	console.log("║  FINAL REPORT SUMMARY                                    ║");
	console.log(`${"╚".padEnd(61, "═")}╝`);
	console.log(`\nWorking shape: ${workingShape}`);
	if (workingShape === "B") {
		console.log(
			"Request body: { queries: string[], documents: string[] }  (parallel arrays)",
		);
		console.log(
			"              optional: { instruction: string }",
		);
		console.log(
			"Response schema: { scores: number[], input_tokens: number, request_id: string|null, inference_status: {...} }",
		);
		console.log(
			"Score semantics: POSITIONAL — scores[i] aligns to documents[i] (no index field)",
		);
		console.log(
			"Task 0.3: queries = Array(docs.length).fill(query)",
		);
		console.log(
			"          Parse response.scores[] directly (positional, no .index needed)",
		);
		console.log(
			"          RerankApiResponseSchema: z.object({ scores: z.array(z.number()), input_tokens: z.number(), ... })",
		);
		console.log(
			`Instruction field accepted: ${instrWorks ? "YES" : "NO"}`,
		);
	} else if (workingShape === "C") {
		console.log("Request body: { query: string, documents: string[] }");
		console.log(
			"Response schema: { scores: number[], ... } (positional, no index)",
		);
		console.log("Score semantics: single query scores all docs positionally");
		console.log(
			"Task 0.3: send query as singular string, not an array",
		);
	} else {
		console.log(
			"Request body: { query: string, documents: string[], return_documents: false }",
		);
		console.log(
			"Response schema: { results: [{index, relevance_score}] }",
		);
		console.log(
			"NOTE: This is the Cohere shape — current production code may actually be correct!",
		);
	}

	console.log(
		"\nSee claudedocs/decisions/phase0-contract.md for decision rationale.",
	);
}

main().catch((err) => {
	console.error("Unhandled error:", err);
	process.exit(1);
});
