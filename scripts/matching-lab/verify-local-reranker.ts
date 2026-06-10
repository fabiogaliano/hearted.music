/**
 * Sanity checks for the local Qwen3-Reranker-0.6B-ONNX path.
 *
 * Drives LocalProvider({ forceDirect: true }).rerank() through three checks:
 *
 *   1. Inversion   — a document containing the query text verbatim → score > 0.9;
 *                    an unrelated document → score < 0.2.
 *   2. Monotonicity — 3 docs of strictly decreasing relevance → strictly
 *                    decreasing scores.
 *   3. Distribution — ~30–50 real (playlist, song) pairs from local Supabase;
 *                    expect spread ~0.05–0.95, NOT clustered at ~0.5.
 *
 * Run:
 *   bun scripts/matching-lab/verify-local-reranker.ts
 *
 * First run downloads ~1.2 GB of ONNX weights from HuggingFace.
 * Requires local Supabase running for the distribution check.
 */

import { LocalProvider } from "../../src/lib/integrations/providers/adapters/local";
import { createLocalLabClient, selectAll } from "./shared";

// ── helpers ──────────────────────────────────────────────────────────────────

function pct(arr: number[], p: number): number {
	if (arr.length === 0) return Number.NaN;
	const sorted = [...arr].sort((a, b) => a - b);
	const idx = (p / 100) * (sorted.length - 1);
	const lo = Math.floor(idx);
	const hi = Math.ceil(idx);
	return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function mean(arr: number[]): number {
	return arr.length === 0
		? Number.NaN
		: arr.reduce((s, v) => s + v, 0) / arr.length;
}

function pass(ok: boolean, label: string) {
	const mark = ok ? "PASS" : "FAIL";
	console.log(`  [${mark}] ${label}`);
	return ok;
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
	console.log("=== Local Qwen3-Reranker Sanity Checks ===\n");
	console.log(
		"Loading model... (first run downloads ~1.2 GB from HuggingFace)\n",
	);

	const provider = new LocalProvider({ forceDirect: true });

	// ── Check 1: Inversion ───────────────────────────────────────────────────

	console.log("── Check 1: Inversion ──────────────────────────────────────");

	const query1 = "upbeat summer pop with driving bass and female vocals";
	const relevant =
		"upbeat summer pop with driving bass and female vocals — perfect for beach playlists";
	const unrelated =
		"a slow ambient drone piece with no melody or rhythm, suited for sleep";

	const t1Start = Date.now();
	const inv = await provider.rerank(query1, [relevant, unrelated], {
		instruction:
			"Given a playlist description, judge whether this song belongs in it.",
	});
	const t1ms = Date.now() - t1Start;

	if (inv.status !== "ok") {
		console.error("  ERROR:", inv.error);
		process.exit(1);
	}

	// scores are sorted desc; find by index
	const byIdx1 = new Map(inv.value.scores.map((s) => [s.index, s.score]));
	const scoreRelevant = byIdx1.get(0) ?? 0;
	const scoreUnrelated = byIdx1.get(1) ?? 0;

	console.log(`  relevant doc   score=${scoreRelevant.toFixed(4)}`);
	console.log(`  unrelated doc  score=${scoreUnrelated.toFixed(4)}`);
	console.log(
		`  latency: ${t1ms}ms total (${Math.round(t1ms / 2)}ms/doc avg)`,
	);

	let allPassed = true;
	allPassed =
		pass(
			scoreRelevant > 0.9,
			`relevant doc score ${scoreRelevant.toFixed(4)} > 0.9`,
		) && allPassed;
	allPassed =
		pass(
			scoreUnrelated < 0.2,
			`unrelated doc score ${scoreUnrelated.toFixed(4)} < 0.2`,
		) && allPassed;
	allPassed =
		pass(
			scoreRelevant > scoreUnrelated,
			"relevant ranked above unrelated",
		) && allPassed;
	console.log();

	// ── Check 2: Monotonicity ────────────────────────────────────────────────

	console.log(
		"── Check 2: Monotonicity ───────────────────────────────────────",
	);

	const query2 = "melancholic indie rock with introspective lyrics";
	const docs2 = [
		// High relevance
		"melancholic indie rock ballad with introspective, poetic lyrics about loss and identity",
		// Medium relevance
		"mid-tempo indie rock song with some atmospheric elements and reflective mood",
		// Low relevance
		"energetic EDM track with heavy drops and crowd-hyping lyrics",
	];
	const labels2 = ["high", "medium", "low"];

	const t2Start = Date.now();
	const mono = await provider.rerank(query2, docs2, {
		instruction:
			"Given a playlist description, judge whether this song belongs in it.",
	});
	const t2ms = Date.now() - t2Start;

	if (mono.status !== "ok") {
		console.error("  ERROR:", mono.error);
		process.exit(1);
	}

	const byIdx2 = new Map(mono.value.scores.map((s) => [s.index, s.score]));
	const scores2 = [0, 1, 2].map((i) => byIdx2.get(i) ?? 0);
	scores2.forEach((s, i) =>
		console.log(`  doc[${i}] (${labels2[i]})  score=${s.toFixed(4)}`),
	);
	console.log(`  latency: ${t2ms}ms total`);

	allPassed =
		pass(
			scores2[0] > scores2[1],
			`high(${scores2[0].toFixed(4)}) > medium(${scores2[1].toFixed(4)})`,
		) && allPassed;
	allPassed =
		pass(
			scores2[1] > scores2[2],
			`medium(${scores2[1].toFixed(4)}) > low(${scores2[2].toFixed(4)})`,
		) && allPassed;
	console.log();

	// ── Check 3: Distribution over real + handcrafted pairs ────────────────

	console.log(
		"── Check 3: Distribution (real playlist × song pairs) ──────────",
	);

	let distScores: number[] = [];
	let distNote = "";

	// Handcrafted pairs with known relevance spread. Always included so the
	// distribution check has signal even when local Supabase data is sparse or
	// has non-descriptive playlist names (common in a dev DB).
	const HANDCRAFTED_INSTRUCTION =
		"Given a playlist description, find songs that match the musical style and mood.";
	const HANDCRAFTED_PAIRS = [
		// Clearly relevant: genre match
		{
			query: "upbeat house and techno dance music for a club night",
			doc: "Around the World by Daft Punk. Genres: house, electronic, dance.",
		},
		{
			query: "upbeat house and techno dance music for a club night",
			doc: "One More Time by Daft Punk. Genres: house, french house, electronic.",
		},
		{
			query: "mellow jazz and soul for late night listening",
			doc: "Blue in Green by Miles Davis. Genres: jazz, modal jazz, cool jazz.",
		},
		{
			query: "indie folk singer-songwriter acoustic introspective",
			doc: "Motion Sickness by Phoebe Bridgers. Genres: indie folk, singer-songwriter.",
		},
		// Partially relevant: adjacent genre
		{
			query: "upbeat house and techno dance music for a club night",
			doc: "Pyramid Song by Radiohead. Genres: art rock, alternative.",
		},
		{
			query: "mellow jazz and soul for late night listening",
			doc: "Kill Bill by SZA. Genres: trap, rnb, pop.",
		},
		{
			query: "indie folk singer-songwriter acoustic introspective",
			doc: "Bad Habit by Steve Lacy. Genres: neo-soul, psychedelic, soul.",
		},
		// Clearly not relevant: genre mismatch
		{
			query: "upbeat house and techno dance music for a club night",
			doc: "drivers license by Olivia Rodrigo. Genres: pop rock, pop, pop punk.",
		},
		{
			query: "mellow jazz and soul for late night listening",
			doc: "Not Like Us by Kendrick Lamar. Genres: trap, hip hop.",
		},
		{
			query: "indie folk singer-songwriter acoustic introspective",
			doc: "Around the World by Daft Punk. Genres: house, electronic, dance.",
		},
	] as const;

	const t3Start = Date.now();
	const handcraftedScores: number[] = [];
	for (const { query, doc } of HANDCRAFTED_PAIRS) {
		const result = await provider.rerank(query, [doc], {
			instruction: HANDCRAFTED_INSTRUCTION,
		});
		if (result.status === "ok" && result.value.scores.length > 0) {
			const s = result.value.scores[0].score;
			handcraftedScores.push(s);
			distScores.push(s);
		}
	}

	// Also pull from local Supabase if available, to augment coverage.
	let dbPairsAdded = 0;
	try {
		const supabase = createLocalLabClient();

		const [playlists, songs, analyses] = await Promise.all([
			selectAll<{ id: string; name: string; description: string | null }>(
				supabase,
				"playlist",
				"id, name, description",
				50,
			),
			selectAll<{
				id: string;
				name: string;
				artists: string[] | null;
				genres: string[] | null;
			}>(supabase, "song", "id, name, artists, genres", 200),
			selectAll<{ song_id: string; analysis: Record<string, unknown> | null }>(
				supabase,
				"song_analysis",
				"song_id, analysis",
				200,
			),
		]);

		// Build analysis text map
		const analysisMap = new Map<string, string>();
		for (const row of analyses) {
			if (!row.analysis) continue;
			const a = row.analysis as Record<string, unknown>;
			const parts: string[] = [];
			if (typeof a.take === "string") parts.push(a.take);
			if (typeof a.tension === "string") parts.push(a.tension);
			if (Array.isArray(a.arc)) {
				for (const seg of a.arc as Array<Record<string, unknown>>) {
					if (typeof seg.mood === "string") parts.push(seg.mood);
				}
			}
			if (typeof a.texture === "string") parts.push(a.texture);
			if (parts.length > 0)
				analysisMap.set(row.song_id, parts.join(" ").slice(0, 1600));
		}

		function songDoc(
			s: (typeof songs)[number],
		): string {
			const artistStr =
				s.artists && s.artists.length > 0 ? s.artists.join(", ") : "Unknown";
			const genreStr =
				s.genres && s.genres.length > 0 ? s.genres.join(", ") : "";
			const meta = `${s.name} by ${artistStr}${genreStr ? `. Genres: ${genreStr}` : ""}.`;
			const analysis = analysisMap.get(s.id);
			return analysis ? `${meta}\n\n${analysis}` : meta;
		}

		// Only include playlists with a real description (not just a name)
		const descriptivePlaylists = playlists
			.filter((p) => p.description && p.description.length > 20)
			.slice(0, 3);
		const sampleSongs = songs.slice(0, 10);

		if (descriptivePlaylists.length > 0 && sampleSongs.length > 0) {
			const dbPairs: { query: string; doc: string }[] = [];
			for (const pl of descriptivePlaylists) {
				const queryText = `${pl.name} — ${pl.description}`;
				for (const s of sampleSongs) {
					dbPairs.push({ query: queryText, doc: songDoc(s) });
				}
			}
			for (const { query, doc } of dbPairs) {
				const result = await provider.rerank(query, [doc], {
					instruction: HANDCRAFTED_INSTRUCTION,
				});
				if (result.status === "ok" && result.value.scores.length > 0) {
					distScores.push(result.value.scores[0].score);
					dbPairsAdded++;
				}
			}
		}
	} catch (err) {
		distNote = `Supabase unavailable (${err instanceof Error ? err.message : String(err)}) — DB pairs skipped.`;
	}

	const t3ms = Date.now() - t3Start;
	const perDoc =
		distScores.length > 0 ? Math.round(t3ms / distScores.length) : 0;

	console.log(
		`  Scored ${distScores.length} pairs (${HANDCRAFTED_PAIRS.length} handcrafted + ${dbPairsAdded} from DB)`,
	);

	if (distScores.length > 0) {
		const q25 = pct(distScores, 25);
		const q75 = pct(distScores, 75);
		const spread = (pct(distScores, 95) - pct(distScores, 5)).toFixed(3);
		console.log(
			`  all  n=${distScores.length}  min=${Math.min(...distScores).toFixed(3)}  max=${Math.max(...distScores).toFixed(3)}  mean=${mean(distScores).toFixed(3)}`,
		);
		console.log(
			`  all  p25=${q25.toFixed(3)}  median=${pct(distScores, 50).toFixed(3)}  p75=${q75.toFixed(3)}  spread(p95-p5)=${spread}`,
		);

		// Report handcrafted-only stats separately (these must show wide spread).
		if (handcraftedScores.length > 0) {
			const hSpread = (
				pct(handcraftedScores, 95) - pct(handcraftedScores, 5)
			).toFixed(3);
			console.log(
				`  craft n=${handcraftedScores.length}  min=${Math.min(...handcraftedScores).toFixed(3)}  max=${Math.max(...handcraftedScores).toFixed(3)}  mean=${mean(handcraftedScores).toFixed(3)}  spread=${hSpread}`,
			);
		}
		console.log(`  latency: ${t3ms}ms total, ~${perDoc}ms/doc`);

		// Scores near 0.5 with no spread indicates wrong template/logit extraction.
		// Clustering at low values is expected with non-descriptive queries (real DB);
		// what matters is that the model discriminates when queries are clear.
		const isClustered =
			Math.abs(mean(distScores) - 0.5) < 0.1 && Number(spread) < 0.15;
		allPassed =
			pass(
				!isClustered,
				`scores not clustered near 0.5 (mean=${mean(distScores).toFixed(3)}, spread=${spread})`,
			) && allPassed;

		// Spread check uses handcrafted pairs only — DB pairs may be all low due to
		// non-descriptive playlist names in the dev environment.
		const hSpreadNum =
			handcraftedScores.length > 0
				? pct(handcraftedScores, 95) - pct(handcraftedScores, 5)
				: 0;
		allPassed =
			pass(
				hSpreadNum > 0.5,
				`handcrafted spread(p95-p5) > 0.50 (actual ${hSpreadNum.toFixed(3)})`,
			) && allPassed;
	} else {
		distNote = "No scores returned from distribution check.";
		console.log(`  NOTE: ${distNote}`);
	}

	if (distNote) {
		console.log(`  NOTE: ${distNote}`);
	}

	// ── Summary ──────────────────────────────────────────────────────────────

	console.log("\n── Summary ──────────────────────────────────────────────────");
	if (allPassed) {
		console.log("  All checks PASSED. Local reranker is working correctly.");
	} else {
		console.log(
			"  One or more checks FAILED. Review scores above and check the",
		);
		console.log(
			"  yes/no token id resolution, chat template, and logit extraction.",
		);
	}
	console.log();
	process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
