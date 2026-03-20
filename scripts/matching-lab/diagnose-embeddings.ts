import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
	"http://127.0.0.1:54321",
	"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU",
);

function cosineSim(a: number[], b: number[]): number {
	if (a.length !== b.length) return 0;
	let dot = 0,
		normA = 0,
		normB = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}
	const denom = Math.sqrt(normA) * Math.sqrt(normB);
	return denom === 0 ? 0 : dot / denom;
}

function parseEmbedding(raw: string | number[] | null): number[] | null {
	if (!raw) return null;
	if (Array.isArray(raw)) return raw;
	try {
		return JSON.parse(raw) as number[];
	} catch {
		return null;
	}
}

function percentile(sorted: number[], p: number): number {
	const idx = (p / 100) * (sorted.length - 1);
	const lo = Math.floor(idx);
	const hi = Math.ceil(idx);
	if (lo === hi) return sorted[lo];
	return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function computeStats(values: number[]) {
	if (values.length === 0) {
		return { min: 0, max: 0, mean: 0, stdev: 0, p5: 0, p25: 0, p50: 0, p75: 0, p95: 0, count: 0 };
	}
	const sorted = [...values].sort((a, b) => a - b);
	const mean = values.reduce((s, v) => s + v, 0) / values.length;
	const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
	return {
		min: sorted[0],
		max: sorted[sorted.length - 1],
		mean,
		stdev: Math.sqrt(variance),
		p5: percentile(sorted, 5),
		p25: percentile(sorted, 25),
		p50: percentile(sorted, 50),
		p75: percentile(sorted, 75),
		p95: percentile(sorted, 95),
		count: values.length,
	};
}

function fmt(n: number): string {
	return n.toFixed(4);
}

interface SongRow {
	id: string;
	song_id: string;
	embedding: string | number[];
	song: { name: string; artists: string[] };
}

interface PlaylistProfileRow {
	id: string;
	playlist_id: string;
	embedding: string | number[] | null;
	playlist: { name: string };
}

async function main() {
	console.log("=== Embedding Diagnostics ===\n");

	// Load song embeddings with song names
	const { data: songRows, error: songErr } = await supabase
		.from("song_embedding")
		.select("id, song_id, embedding, song(name, artists)");

	if (songErr) {
		console.error("Failed to load song embeddings:", songErr.message);
		process.exit(1);
	}

	// Load playlist profiles with playlist names
	const { data: profileRows, error: profileErr } = await supabase
		.from("playlist_profile")
		.select("id, playlist_id, embedding, playlist(name)");

	if (profileErr) {
		console.error("Failed to load playlist profiles:", profileErr.message);
		process.exit(1);
	}

	const songs = (songRows as unknown as SongRow[])
		.map((r) => ({
			id: r.song_id,
			name: r.song?.name ?? "Unknown",
			artists: r.song?.artists ?? [],
			embedding: parseEmbedding(r.embedding),
		}))
		.filter((s) => s.embedding !== null) as Array<{
		id: string;
		name: string;
		artists: string[];
		embedding: number[];
	}>;

	const playlists = (profileRows as unknown as PlaylistProfileRow[])
		.map((r) => ({
			id: r.playlist_id,
			name: r.playlist?.name ?? "Unknown",
			embedding: parseEmbedding(r.embedding),
		}))
		.filter((p) => p.embedding !== null) as Array<{
		id: string;
		name: string;
		embedding: number[];
	}>;

	console.log(`Loaded ${songs.length} song embeddings, ${playlists.length} playlist profiles\n`);

	if (songs.length === 0 || playlists.length === 0) {
		console.log("Not enough data to compute similarities.");
		process.exit(0);
	}

	// Compute full similarity matrix: songs × playlists
	// simMatrix[songIdx][playlistIdx] = cosine similarity
	const simMatrix: number[][] = [];
	const allSims: number[] = [];

	for (let si = 0; si < songs.length; si++) {
		simMatrix[si] = [];
		for (let pi = 0; pi < playlists.length; pi++) {
			const sim = cosineSim(songs[si].embedding, playlists[pi].embedding);
			simMatrix[si][pi] = sim;
			allSims.push(sim);
		}
	}

	console.log("━".repeat(120));
	console.log("  PER-PLAYLIST SIMILARITY STATS (across all songs)");
	console.log("━".repeat(120));

	const playlistStatsHeader = [
		"Playlist".padEnd(30),
		"Count".padStart(6),
		"Min".padStart(8),
		"P5".padStart(8),
		"P25".padStart(8),
		"P50".padStart(8),
		"Mean".padStart(8),
		"P75".padStart(8),
		"P95".padStart(8),
		"Max".padStart(8),
		"StDev".padStart(8),
	].join(" │ ");

	console.log(playlistStatsHeader);
	console.log("─".repeat(120));

	for (let pi = 0; pi < playlists.length; pi++) {
		const sims = simMatrix.map((row) => row[pi]);
		const stats = computeStats(sims);
		const row = [
			playlists[pi].name.slice(0, 30).padEnd(30),
			String(stats.count).padStart(6),
			fmt(stats.min).padStart(8),
			fmt(stats.p5).padStart(8),
			fmt(stats.p25).padStart(8),
			fmt(stats.p50).padStart(8),
			fmt(stats.mean).padStart(8),
			fmt(stats.p75).padStart(8),
			fmt(stats.p95).padStart(8),
			fmt(stats.max).padStart(8),
			fmt(stats.stdev).padStart(8),
		].join(" │ ");
		console.log(row);
	}

	console.log("\n" + "━".repeat(120));
	console.log("  OVERALL SIMILARITY STATS (all song×playlist pairs)");
	console.log("━".repeat(120));

	const overall = computeStats(allSims);
	console.log(`  Total pairs : ${overall.count}`);
	console.log(`  Min         : ${fmt(overall.min)}`);
	console.log(`  P5          : ${fmt(overall.p5)}`);
	console.log(`  P25         : ${fmt(overall.p25)}`);
	console.log(`  P50 (median): ${fmt(overall.p50)}`);
	console.log(`  Mean        : ${fmt(overall.mean)}`);
	console.log(`  P75         : ${fmt(overall.p75)}`);
	console.log(`  P95         : ${fmt(overall.p95)}`);
	console.log(`  Max         : ${fmt(overall.max)}`);
	console.log(`  StDev       : ${fmt(overall.stdev)}`);

	console.log("\n" + "━".repeat(120));
	console.log("  PER-SONG SPREAD: best playlist sim - worst playlist sim");
	console.log("━".repeat(120));

	const songSpreads = songs.map((song, si) => {
		const sims = simMatrix[si];
		const maxSim = Math.max(...sims);
		const minSim = Math.min(...sims);
		const bestIdx = sims.indexOf(maxSim);
		const worstIdx = sims.indexOf(minSim);
		return {
			name: song.name,
			artists: song.artists.join(", "),
			spread: maxSim - minSim,
			maxSim,
			minSim,
			bestPlaylist: playlists[bestIdx].name,
			worstPlaylist: playlists[worstIdx].name,
		};
	});

	songSpreads.sort((a, b) => b.spread - a.spread);

	console.log("\n  TOP 5 (largest spread — most differentiated songs):");
	const spreadHeader = [
		"Song".padEnd(35),
		"Artists".padEnd(25),
		"Spread".padStart(8),
		"Best".padStart(8),
		"Worst".padStart(8),
		"Best Playlist".padEnd(25),
		"Worst Playlist".padEnd(25),
	].join(" │ ");
	console.log("  " + spreadHeader);
	console.log("  " + "─".repeat(140));

	for (const s of songSpreads.slice(0, 5)) {
		const row = [
			s.name.slice(0, 35).padEnd(35),
			s.artists.slice(0, 25).padEnd(25),
			fmt(s.spread).padStart(8),
			fmt(s.maxSim).padStart(8),
			fmt(s.minSim).padStart(8),
			s.bestPlaylist.slice(0, 25).padEnd(25),
			s.worstPlaylist.slice(0, 25).padEnd(25),
		].join(" │ ");
		console.log("  " + row);
	}

	console.log("\n  BOTTOM 5 (smallest spread — least differentiated songs):");
	console.log("  " + spreadHeader);
	console.log("  " + "─".repeat(140));

	for (const s of songSpreads.slice(-5)) {
		const row = [
			s.name.slice(0, 35).padEnd(35),
			s.artists.slice(0, 25).padEnd(25),
			fmt(s.spread).padStart(8),
			fmt(s.maxSim).padStart(8),
			fmt(s.minSim).padStart(8),
			s.bestPlaylist.slice(0, 25).padEnd(25),
			s.worstPlaylist.slice(0, 25).padEnd(25),
		].join(" │ ");
		console.log("  " + row);
	}

	console.log("\n" + "━".repeat(120));
	console.log("  INTER-PLAYLIST SIMILARITY MATRIX (playlist embedding vs playlist embedding)");
	console.log("━".repeat(120));

	const nameWidth = 20;
	const cellWidth = 8;

	// Header row
	const matrixHeader =
		"".padEnd(nameWidth + 3) + playlists.map((p) => p.name.slice(0, cellWidth).padStart(cellWidth)).join("  ");
	console.log(matrixHeader);
	console.log("─".repeat(nameWidth + 3 + playlists.length * (cellWidth + 2)));

	for (let i = 0; i < playlists.length; i++) {
		const cells: string[] = [];
		for (let j = 0; j < playlists.length; j++) {
			if (i === j) {
				cells.push("  1.0000".padStart(cellWidth));
			} else {
				const sim = cosineSim(playlists[i].embedding, playlists[j].embedding);
				cells.push(fmt(sim).padStart(cellWidth));
			}
		}
		const rowLabel = playlists[i].name.slice(0, nameWidth).padEnd(nameWidth);
		console.log(`${rowLabel}   ${cells.join("  ")}`);
	}

	// Summary of inter-playlist similarities
	const interPlaylistSims: number[] = [];
	for (let i = 0; i < playlists.length; i++) {
		for (let j = i + 1; j < playlists.length; j++) {
			interPlaylistSims.push(cosineSim(playlists[i].embedding, playlists[j].embedding));
		}
	}

	if (interPlaylistSims.length > 0) {
		const ipStats = computeStats(interPlaylistSims);
		console.log(`\n  Inter-playlist summary (${ipStats.count} pairs):`);
		console.log(`    Min  : ${fmt(ipStats.min)}    Max  : ${fmt(ipStats.max)}`);
		console.log(`    Mean : ${fmt(ipStats.mean)}    StDev: ${fmt(ipStats.stdev)}`);
		console.log(`    P25  : ${fmt(ipStats.p25)}    P50  : ${fmt(ipStats.p50)}    P75: ${fmt(ipStats.p75)}`);
	}

	console.log("\n" + "━".repeat(120));
	console.log("  Done.");
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
