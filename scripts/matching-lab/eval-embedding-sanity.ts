/**
 * Directional embedding sanity check against the match_decision log.
 *
 * This is NOT the full offline replay harness (roadmap #2). It is the
 * scale-appropriate stand-in: replay the per-(song, playlist) decisions we
 * have and check that the new embeddings rank `added` songs above `dismissed`
 * ones for each playlist. With a handful of decisions on a single playlist the
 * numbers are directional only — enough to catch a format/model regression
 * (added scoring below dismissed), not to choose between close configs.
 *
 * Run after re-embedding + re-profiling:
 *   bun run scripts/matching-lab/eval-embedding-sanity.ts
 */

import {
	cosineSim,
	createLocalLabClient,
	mean,
	parseEmbedding,
	selectAll,
} from "./shared";

const supabase = createLocalLabClient();

async function main() {
	console.log("=== Embedding sanity check (decision replay) ===\n");

	const [songRows, profileRows, decisionRows] = await Promise.all([
		selectAll<{
			song_id: string;
			embedding: string;
			dims: number;
			model: string;
		}>(supabase, "song_embedding", "song_id, embedding, dims, model"),
		selectAll<{
			playlist_id: string;
			embedding: string;
			playlist: { name?: string } | null;
		}>(supabase, "playlist_profile", "playlist_id, embedding, playlist(name)"),
		selectAll<{ song_id: string; playlist_id: string; decision: string }>(
			supabase,
			"match_decision",
			"song_id, playlist_id, decision",
		),
	]);

	const songEmb = new Map<string, number[]>();
	for (const r of songRows) {
		const e = parseEmbedding(r.embedding);
		if (e) songEmb.set(r.song_id, e);
	}

	const model = songRows[0]?.model ?? "(none)";
	const dims = songRows[0]?.dims ?? 0;
	console.log(`Model: ${model} @ ${dims}d`);
	console.log(
		`Embedded songs: ${songEmb.size} | profiles: ${profileRows.length} | decisions: ${decisionRows.length}\n`,
	);

	if (songEmb.size === 0 || profileRows.length === 0 || decisionRows.length === 0) {
		console.log(
			"Not enough data — re-embed + re-profile first, and ensure decisions exist.",
		);
		process.exit(0);
	}

	let totalAdded = 0;
	let totalDismissed = 0;
	let playlistsWithSignal = 0;
	let correctlyOrdered = 0;

	for (const profile of profileRows) {
		const profileEmb = parseEmbedding(profile.embedding);
		if (!profileEmb) continue;

		const decisions = decisionRows.filter(
			(d) => d.playlist_id === profile.playlist_id,
		);
		if (decisions.length === 0) continue;

		// Rank every embedded song against this profile.
		const ranked = [...songEmb.entries()]
			.map(([id, emb]) => ({ id, sim: cosineSim(emb, profileEmb) }))
			.sort((a, b) => b.sim - a.sim);
		const byId = new Map(
			ranked.map((r, i) => [r.id, { sim: r.sim, rank: i + 1 }]),
		);

		const addedSims: number[] = [];
		const dismissedSims: number[] = [];
		const addedRanks: number[] = [];
		const dismissedRanks: number[] = [];

		for (const d of decisions) {
			const scored = byId.get(d.song_id);
			if (!scored) continue;
			if (d.decision === "added") {
				addedSims.push(scored.sim);
				addedRanks.push(scored.rank);
			} else {
				dismissedSims.push(scored.sim);
				dismissedRanks.push(scored.rank);
			}
		}

		const name = profile.playlist?.name ?? "Unknown";
		console.log(`▸ ${name}  (${ranked.length} candidates)`);
		console.log(
			`    added     n=${addedSims.length}  meanSim=${mean(addedSims).toFixed(4)}  meanRank=${mean(addedRanks).toFixed(1)}`,
		);
		console.log(
			`    dismissed n=${dismissedSims.length}  meanSim=${mean(dismissedSims).toFixed(4)}  meanRank=${mean(dismissedRanks).toFixed(1)}`,
		);

		if (addedSims.length > 0 && dismissedSims.length > 0) {
			playlistsWithSignal++;
			const sep = mean(addedSims) - mean(dismissedSims);
			const ordered = sep > 0;
			if (ordered) correctlyOrdered++;
			console.log(
				`    separation (added − dismissed): ${sep >= 0 ? "+" : ""}${sep.toFixed(4)}  ${ordered ? "✓ added ranked higher" : "✗ dismissed ranked higher"}`,
			);
		}
		totalAdded += addedSims.length;
		totalDismissed += dismissedSims.length;
		console.log();
	}

	console.log("─".repeat(60));
	console.log(
		`Decisions scored: ${totalAdded} added / ${totalDismissed} dismissed across ${profileRows.length} profiles`,
	);
	if (playlistsWithSignal > 0) {
		console.log(
			`Playlists where added outranked dismissed: ${correctlyOrdered}/${playlistsWithSignal}`,
		);
	}
	console.log(
		"\n⚠️  Directional only — sample is far below the ~300–500 pairs needed",
	);
	console.log(
		"    for a trustworthy verdict. Use as a regression smoke test, not a ranking.",
	);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
