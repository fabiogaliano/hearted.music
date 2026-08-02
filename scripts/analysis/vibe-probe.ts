#!/usr/bin/env bun

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import postgres, { type Sql } from "postgres";

const ACCOUNT_NAME = "fabiogaliano";
const CONTAINER_NAME = "supabase_db_v1_hearted";
const LOCAL_DATABASE_URL =
	"postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const REPORT_PATH = resolve(process.cwd(), "docs/tmp/vibe-probe-report.md");
const EMBEDDING_DIMENSIONS = 512;
const MEANINGFUL_SILHOUETTE = 0.09;
const NEAR_BEST_TOLERANCE = 0.02;
const BASE_SEED = 0x48_45_41_52;

const AUDIO_FEATURES = [
	"energy",
	"valence",
	"danceability",
	"acousticness",
	"instrumentalness",
	"speechiness",
	"liveness",
	"tempo",
	"loudness",
] as const;

type Vector = Float32Array;

interface AccountRow {
	id: string;
	display_name: string | null;
	spotify_id: string | null;
}

interface LibraryRow {
	song_id: string;
	name: string;
	artists: string[];
	genres: string[];
	embedding: string | null;
	embedding_model: string | null;
	embedding_model_version: string | null;
	energy: number | null;
	valence: number | null;
	danceability: number | null;
	acousticness: number | null;
	instrumentalness: number | null;
	speechiness: number | null;
	liveness: number | null;
	tempo: number | null;
	loudness: number | null;
}

interface Song {
	id: string;
	name: string;
	artists: string[];
	genres: string[];
}

interface Dataset {
	songs: Song[];
	vectors: Vector[];
}

interface KMeansResult {
	k: number;
	labels: Int16Array;
	centers: Float64Array[];
	inertia: number;
	iterations: number;
}

interface CandidateResult extends KMeansResult {
	silhouette: number;
	sizes: number[];
	meetsMinSize: boolean;
}

interface ModalityResult {
	name: "Semantic" | "Sonic";
	dataset: Dataset;
	candidateResults: CandidateResult[];
	chosen: CandidateResult | null;
	diagnostic: CandidateResult | null;
	minClusterSize: number;
	maxK: number;
	distanceMatrix: Float32Array;
	note: string;
}

interface ClusterSummary {
	size: number;
	medoidIndex: number;
	nearestIndices: number[];
	topGenres: Array<{ genre: string; count: number }>;
}

function mulberry32(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d_2b_79_f5) >>> 0;
		let value = state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
	};
}

function parseEmbedding(raw: string | null): Vector | null {
	if (!raw) return null;
	const values = raw
		.slice(raw.startsWith("[") ? 1 : 0, raw.endsWith("]") ? -1 : undefined)
		.split(",")
		.map(Number);
	if (
		values.length !== EMBEDDING_DIMENSIONS ||
		values.some((value) => !Number.isFinite(value))
	) {
		return null;
	}

	let normSquared = 0;
	for (const value of values) normSquared += value * value;
	if (normSquared === 0) return null;

	const norm = Math.sqrt(normSquared);
	return Float32Array.from(values, (value) => value / norm);
}

function quantile(sorted: number[], fraction: number): number {
	const position = (sorted.length - 1) * fraction;
	const lower = Math.floor(position);
	const upper = Math.ceil(position);
	if (lower === upper) return sorted[lower];
	const weight = position - lower;
	return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function buildDatasets(rows: LibraryRow[]): {
	semantic: Dataset;
	sonic: Dataset;
	models: string[];
} {
	const semantic: Dataset = { songs: [], vectors: [] };
	const sonicSongs: Song[] = [];
	const sonicRaw: number[][] = [];
	const models = new Set<string>();

	for (const row of rows) {
		const song: Song = {
			id: row.song_id,
			name: row.name,
			artists: row.artists ?? [],
			genres: row.genres ?? [],
		};
		const embedding = parseEmbedding(row.embedding);
		if (embedding) {
			semantic.songs.push(song);
			semantic.vectors.push(embedding);
			models.add(
				`${row.embedding_model ?? "unknown"}${
					row.embedding_model_version
						? ` (${row.embedding_model_version})`
						: ""
				}`,
			);
		}

		const audio = AUDIO_FEATURES.map((feature) => row[feature]);
		if (audio.every((value): value is number => value !== null && Number.isFinite(value))) {
			sonicSongs.push(song);
			sonicRaw.push(audio);
		}
	}

	const medians: number[] = [];
	const scales: number[] = [];
	for (let featureIndex = 0; featureIndex < AUDIO_FEATURES.length; featureIndex++) {
		const sorted = sonicRaw
			.map((values) => values[featureIndex])
			.toSorted((a, b) => a - b);
		const median = quantile(sorted, 0.5);
		const iqr = quantile(sorted, 0.75) - quantile(sorted, 0.25);
		medians.push(median);
		scales.push(iqr > 1e-12 ? iqr : 1);
	}

	const sonic: Dataset = {
		songs: sonicSongs,
		vectors: sonicRaw.map((values) =>
			Float32Array.from(values, (value, index) =>
				(value - medians[index]) / scales[index],
			),
		),
	};

	return { semantic, sonic, models: [...models].toSorted() };
}

function squaredDistance(a: ArrayLike<number>, b: ArrayLike<number>): number {
	let sum = 0;
	for (let index = 0; index < a.length; index++) {
		const difference = a[index] - b[index];
		sum += difference * difference;
	}
	return sum;
}

function initializeKMeansPlusPlus(
	vectors: Vector[],
	k: number,
	random: () => number,
): Float64Array[] {
	const centers: Float64Array[] = [];
	const chosen = new Set<number>();
	const firstIndex = Math.floor(random() * vectors.length);
	chosen.add(firstIndex);
	centers.push(Float64Array.from(vectors[firstIndex]));
	const nearestDistances = Float64Array.from(vectors, (vector) =>
		squaredDistance(vector, vectors[firstIndex]),
	);

	while (centers.length < k) {
		let total = 0;
		for (const distance of nearestDistances) total += distance;

		let selectedIndex = -1;
		if (total > 0) {
			let target = random() * total;
			for (let index = 0; index < vectors.length; index++) {
				target -= nearestDistances[index];
				if (target <= 0 && !chosen.has(index)) {
					selectedIndex = index;
					break;
				}
			}
		}
		if (selectedIndex === -1) {
			selectedIndex = vectors.findIndex((_vector, index) => !chosen.has(index));
		}
		if (selectedIndex === -1) break;

		chosen.add(selectedIndex);
		centers.push(Float64Array.from(vectors[selectedIndex]));
		for (let index = 0; index < vectors.length; index++) {
			nearestDistances[index] = Math.min(
				nearestDistances[index],
				squaredDistance(vectors[index], vectors[selectedIndex]),
			);
		}
	}

	return centers;
}

function assignPoints(
	vectors: Vector[],
	centers: Float64Array[],
	previousLabels?: Int16Array,
): {
	labels: Int16Array;
	distances: Float64Array;
	inertia: number;
	changed: number;
} {
	const labels = new Int16Array(vectors.length);
	const distances = new Float64Array(vectors.length);
	let inertia = 0;
	let changed = 0;

	for (let pointIndex = 0; pointIndex < vectors.length; pointIndex++) {
		let bestCluster = 0;
		let bestDistance = Number.POSITIVE_INFINITY;
		for (let cluster = 0; cluster < centers.length; cluster++) {
			const distance = squaredDistance(vectors[pointIndex], centers[cluster]);
			if (distance < bestDistance) {
				bestDistance = distance;
				bestCluster = cluster;
			}
		}
		labels[pointIndex] = bestCluster;
		distances[pointIndex] = bestDistance;
		inertia += bestDistance;
		if (!previousLabels || previousLabels[pointIndex] !== bestCluster) changed++;
	}

	return { labels, distances, inertia, changed };
}

function recomputeCenters(
	vectors: Vector[],
	labels: Int16Array,
	distances: Float64Array,
	k: number,
): { centers: Float64Array[]; counts: number[]; hadEmptyCluster: boolean } {
	const dimensions = vectors[0].length;
	const centers = Array.from({ length: k }, () => new Float64Array(dimensions));
	const counts = Array.from({ length: k }, () => 0);

	for (let pointIndex = 0; pointIndex < vectors.length; pointIndex++) {
		const cluster = labels[pointIndex];
		counts[cluster]++;
		const center = centers[cluster];
		const vector = vectors[pointIndex];
		for (let dimension = 0; dimension < dimensions; dimension++) {
			center[dimension] += vector[dimension];
		}
	}

	const reseededPoints = new Set<number>();
	let hadEmptyCluster = false;
	for (let cluster = 0; cluster < k; cluster++) {
		if (counts[cluster] > 0) {
			for (let dimension = 0; dimension < dimensions; dimension++) {
				centers[cluster][dimension] /= counts[cluster];
			}
			continue;
		}

		hadEmptyCluster = true;
		let farthestPoint = -1;
		let farthestDistance = -1;
		for (let pointIndex = 0; pointIndex < vectors.length; pointIndex++) {
			if (
				!reseededPoints.has(pointIndex) &&
				distances[pointIndex] > farthestDistance
			) {
				farthestPoint = pointIndex;
				farthestDistance = distances[pointIndex];
			}
		}
		if (farthestPoint >= 0) {
			reseededPoints.add(farthestPoint);
			centers[cluster] = Float64Array.from(vectors[farthestPoint]);
		}
	}

	return { centers, counts, hadEmptyCluster };
}

function runKMeans(
	vectors: Vector[],
	k: number,
	restarts: number,
	maxIterations: number,
	seedSalt: number,
): KMeansResult {
	let best: KMeansResult | null = null;

	for (let restart = 0; restart < restarts; restart++) {
		const random = mulberry32(
			(BASE_SEED ^ seedSalt ^ Math.imul(k + 1, 0x9e_37_79_b1) ^ restart) >>> 0,
		);
		let centers = initializeKMeansPlusPlus(vectors, k, random);
		let labels: Int16Array | undefined;
		let iterations = 0;

		for (let iteration = 1; iteration <= maxIterations; iteration++) {
			iterations = iteration;
			const assignment = assignPoints(vectors, centers, labels);
			labels = assignment.labels;
			const recomputed = recomputeCenters(
				vectors,
				labels,
				assignment.distances,
				k,
			);
			centers = recomputed.centers;
			if (assignment.changed === 0 && !recomputed.hadEmptyCluster) break;
		}

		const finalAssignment = assignPoints(vectors, centers);
		const result: KMeansResult = {
			k,
			labels: finalAssignment.labels,
			centers,
			inertia: finalAssignment.inertia,
			iterations,
		};
		if (!best || result.inertia < best.inertia) best = result;
	}

	if (!best) throw new Error(`k-means produced no result for k=${k}`);
	return best;
}

function buildDistanceMatrix(vectors: Vector[]): Float32Array {
	const size = vectors.length;
	const matrix = new Float32Array(size * size);
	for (let left = 0; left < size; left++) {
		for (let right = left + 1; right < size; right++) {
			const distance = Math.sqrt(squaredDistance(vectors[left], vectors[right]));
			matrix[left * size + right] = distance;
			matrix[right * size + left] = distance;
		}
	}
	return matrix;
}

function clusterSizes(labels: Int16Array, k: number): number[] {
	const sizes = Array.from({ length: k }, () => 0);
	for (const label of labels) sizes[label]++;
	return sizes;
}

function meanSilhouette(
	labels: Int16Array,
	k: number,
	distanceMatrix: Float32Array,
): number {
	const size = labels.length;
	const counts = clusterSizes(labels, k);
	let totalSilhouette = 0;

	for (let point = 0; point < size; point++) {
		const sums = new Float64Array(k);
		const rowOffset = point * size;
		for (let other = 0; other < size; other++) {
			sums[labels[other]] += distanceMatrix[rowOffset + other];
		}

		const ownCluster = labels[point];
		const ownCount = counts[ownCluster];
		if (ownCount <= 1) continue;
		const within = sums[ownCluster] / (ownCount - 1);
		let nearestOther = Number.POSITIVE_INFINITY;
		for (let cluster = 0; cluster < k; cluster++) {
			if (cluster === ownCluster || counts[cluster] === 0) continue;
			nearestOther = Math.min(nearestOther, sums[cluster] / counts[cluster]);
		}
		const denominator = Math.max(within, nearestOther);
		if (denominator > 0 && Number.isFinite(nearestOther)) {
			totalSilhouette += (nearestOther - within) / denominator;
		}
	}

	return totalSilhouette / size;
}

function analyzeModality(options: {
	name: ModalityResult["name"];
	dataset: Dataset;
	maxK: number;
	minClusterSize: number;
	restarts: number;
	seedSalt: number;
	note: string;
}): ModalityResult {
	const distanceMatrix = buildDistanceMatrix(options.dataset.vectors);
	const candidateResults: CandidateResult[] = [];

	for (let k = 2; k <= options.maxK; k++) {
		const result = runKMeans(
			options.dataset.vectors,
			k,
			options.restarts,
			30,
			options.seedSalt,
		);
		const sizes = clusterSizes(result.labels, k);
		candidateResults.push({
			...result,
			silhouette: meanSilhouette(result.labels, k, distanceMatrix),
			sizes,
			meetsMinSize: Math.min(...sizes) >= options.minClusterSize,
		});
	}

	const eligible = candidateResults.filter((candidate) => candidate.meetsMinSize);
	const diagnostic = eligible.reduce<CandidateResult | null>(
		(best, candidate) =>
			!best || candidate.silhouette > best.silhouette ? candidate : best,
		null,
	);
	const chosen =
		diagnostic && diagnostic.silhouette >= MEANINGFUL_SILHOUETTE
			? (eligible.find(
					(candidate) =>
						candidate.silhouette >=
						diagnostic.silhouette - NEAR_BEST_TOLERANCE,
				) ?? null)
			: null;

	return {
		name: options.name,
		dataset: options.dataset,
		candidateResults,
		chosen,
		diagnostic,
		minClusterSize: options.minClusterSize,
		maxK: options.maxK,
		distanceMatrix,
		note: options.note,
	};
}

function summarizeClusters(
	result: CandidateResult,
	dataset: Dataset,
	distanceMatrix: Float32Array,
): ClusterSummary[] {
	const groups = Array.from({ length: result.k }, () => [] as number[]);
	for (let index = 0; index < result.labels.length; index++) {
		groups[result.labels[index]].push(index);
	}

	return groups
		.map((indices) => {
			let medoidIndex = indices[0];
			let lowestDistanceSum = Number.POSITIVE_INFINITY;
			for (const candidate of indices) {
				let distanceSum = 0;
				for (const other of indices) {
					distanceSum +=
						distanceMatrix[candidate * dataset.songs.length + other];
				}
				if (distanceSum < lowestDistanceSum) {
					medoidIndex = candidate;
					lowestDistanceSum = distanceSum;
				}
			}

			const nearestIndices = indices
				.filter((index) => index !== medoidIndex)
				.toSorted((left, right) => {
					const distanceDifference =
						distanceMatrix[medoidIndex * dataset.songs.length + left] -
						distanceMatrix[medoidIndex * dataset.songs.length + right];
					return (
						distanceDifference ||
						formatSong(dataset.songs[left]).localeCompare(
							formatSong(dataset.songs[right]),
						)
					);
				})
				.slice(0, 5);

			const genreCounts = new Map<string, number>();
			for (const index of indices) {
				for (const rawGenre of new Set(dataset.songs[index].genres)) {
					const genre = rawGenre.trim().toLowerCase();
					if (genre) genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1);
				}
			}
			const topGenres = [...genreCounts]
				.map(([genre, count]) => ({ genre, count }))
				.toSorted(
					(left, right) =>
						right.count - left.count || left.genre.localeCompare(right.genre),
				)
				.slice(0, 5);

			return {
				size: indices.length,
				medoidIndex,
				nearestIndices,
				topGenres,
			};
		})
		.toSorted(
			(left, right) =>
				right.size - left.size ||
				formatSong(dataset.songs[left.medoidIndex]).localeCompare(
					formatSong(dataset.songs[right.medoidIndex]),
				),
		);
}

function cleanMarkdownText(value: string): string {
	return value.replaceAll("\n", " ").replaceAll("\r", " ").trim();
}

function formatSong(song: Song): string {
	const artists = song.artists.length > 0 ? song.artists.join(", ") : "Unknown artist";
	return `${cleanMarkdownText(song.name)} — ${cleanMarkdownText(artists)}`;
}

function formatSilhouette(value: number): string {
	return value.toFixed(3);
}

function modalityVerdict(result: ModalityResult): string {
	if (result.chosen) return `k=${result.chosen.k}`;
	return "no meaningful clustering";
}

function renderModality(result: ModalityResult): string[] {
	const lines: string[] = [];
	lines.push(`## ${result.name}`, "");
	lines.push(
		`**Usable songs:** ${result.dataset.songs.length} · **Candidate k:** 2–${result.maxK} · **Minimum cluster size:** ${result.minClusterSize}`,
		"",
		result.note,
		"",
	);

	if (result.chosen) {
		lines.push(
			`**Chosen k:** ${result.chosen.k} (mean silhouette ${formatSilhouette(result.chosen.silhouette)}). This is the smallest eligible k within ${NEAR_BEST_TOLERANCE.toFixed(2)} of the best eligible candidate.`,
			"",
		);
	} else if (result.diagnostic) {
		lines.push(
			`**Chosen k:** none — **no meaningful clustering**. The best size-eligible candidate was k=${result.diagnostic.k} at ${formatSilhouette(result.diagnostic.silhouette)}, below the ${MEANINGFUL_SILHOUETTE.toFixed(2)} probe threshold. Its partition is printed below for diagnosis, not accepted as evidence of vibes.`,
			"",
		);
	} else {
		lines.push(
			`**Chosen k:** none — **no meaningful clustering**. No candidate satisfied the minimum cluster size.`,
			"",
		);
	}

	lines.push(
		"| k | Mean silhouette | Cluster sizes (ascending) | Minimum size met? |",
		"|---:|---:|:---|:---:|",
	);
	for (const candidate of result.candidateResults) {
		lines.push(
			`| ${candidate.k} | ${formatSilhouette(candidate.silhouette)} | ${candidate.sizes.toSorted((a, b) => a - b).join(", ")} | ${candidate.meetsMinSize ? "yes" : "no"} |`,
		);
	}
	lines.push("");

	const partition = result.chosen ?? result.diagnostic;
	if (!partition) return lines;
	lines.push(
		result.chosen
			? "### Chosen partition"
			: "### Diagnostic partition (not accepted)",
		"",
	);
	const clusters = summarizeClusters(
		partition,
		result.dataset,
		result.distanceMatrix,
	);
	for (let index = 0; index < clusters.length; index++) {
		const cluster = clusters[index];
		lines.push(
			`#### Cluster ${index + 1} — ${cluster.size} songs`,
			"",
			`**Medoid:** ${formatSong(result.dataset.songs[cluster.medoidIndex])}`,
			"",
			"**Five songs nearest the medoid:**",
			"",
		);
		for (const nearestIndex of cluster.nearestIndices) {
			lines.push(`- ${formatSong(result.dataset.songs[nearestIndex])}`);
		}
		lines.push("");
		lines.push(
			cluster.topGenres.length > 0
				? `**Top genre tags:** ${cluster.topGenres.map(({ genre, count }) => `\`${genre.replaceAll("`", "\\`")}\` (${count})`).join(" · ")}`
				: "**Top genre tags:** none",
			"",
		);
	}

	return lines;
}

function renderReport(options: {
	account: AccountRow;
	rows: LibraryRow[];
	models: string[];
	semantic: ModalityResult;
	sonic: ModalityResult;
}): string {
	const lines = [
		"# Vibe probe report",
		"",
		`**Account:** ${options.account.display_name ?? ACCOUNT_NAME} (${options.account.id})  `,
		`**Source:** local Supabase container \`${CONTAINER_NAME}\` (read-only transaction)  `,
		`**Active liked songs:** ${options.rows.length}  `,
		`**Embedding model(s):** ${options.models.length > 0 ? options.models.map((model) => `\`${model}\``).join(", ") : "none"}`,
		"",
		"## Result at a glance",
		"",
		"| Modality | Usable songs | Chosen result | Best size-eligible silhouette |",
		"|:---|---:|:---|---:|",
		`| Semantic | ${options.semantic.dataset.songs.length} | ${modalityVerdict(options.semantic)} | ${options.semantic.diagnostic ? formatSilhouette(options.semantic.diagnostic.silhouette) : "n/a"} |`,
		`| Sonic | ${options.sonic.dataset.songs.length} | ${modalityVerdict(options.sonic)} | ${options.sonic.diagnostic ? formatSilhouette(options.sonic.diagnostic.silhouette) : "n/a"} |`,
		"",
		`“Meaningful” here only means mean silhouette ≥ ${MEANINGFUL_SILHOUETTE.toFixed(2)} after the minimum-size constraint. It does **not** decide whether a cluster is musically recognizable; review the medoids, neighbors, and genre tags below. The roadmap passes only if at least one chosen partition has ≥3 clusters and roughly 70% of those clusters read as genuine taste areas.`,
		"",
		"## Method",
		"",
		"- Semantic: latest 512-dimensional `full` embedding per active liked song, L2-normalized; k-means++ with 5 seeded restarts and at most 30 iterations.",
		`- Sonic: all nine complete audio features (${AUDIO_FEATURES.join(", ")}), independently standardized as (value − median) / IQR; k-means++ with 10 seeded restarts and at most 30 iterations.`,
		"- Euclidean distance is used for fitting, silhouette, medoids, and nearest-medoid songs. Each candidate keeps the lowest-inertia restart.",
		`- Selection: among candidates meeting the minimum size, choose the smallest k within ${NEAR_BEST_TOLERANCE.toFixed(2)} silhouette of the best; reject the modality when the best eligible silhouette is below ${MEANINGFUL_SILHOUETTE.toFixed(2)}.`,
		"- Genre tags are raw song tags counted once per song. Cluster numbers are ordered largest-first for review; they are not stable identities.",
		"",
		...renderModality(options.semantic),
		...renderModality(options.sonic),
	];
	return `${lines.join("\n").trimEnd()}\n`;
}

async function loadLibrary(
	sql: Sql,
): Promise<{ account: AccountRow; rows: LibraryRow[] }> {
	return sql.begin(async (transaction) => {
		// The transaction guard makes accidental future query edits fail closed.
		await transaction.unsafe("set transaction read only");
		const accounts = await transaction<AccountRow[]>`
			select id, display_name, spotify_id
			from public.account
			where display_name = ${ACCOUNT_NAME}
			order by id
		`;
		if (accounts.length !== 1) {
			throw new Error(
				`Expected exactly one local account named ${ACCOUNT_NAME}; found ${accounts.length}.`,
			);
		}
		const account = accounts[0];
		const rows = await transaction<LibraryRow[]>`
			select
				s.id as song_id,
				s.name,
				s.artists,
				s.genres,
				e.embedding,
				e.model as embedding_model,
				e.model_version as embedding_model_version,
				af.energy,
				af.valence,
				af.danceability,
				af.acousticness,
				af.instrumentalness,
				af.speechiness,
				af.liveness,
				af.tempo,
				af.loudness
			from public.liked_song ls
			join public.song s on s.id = ls.song_id
			left join public.song_audio_feature af on af.song_id = s.id
			left join lateral (
				select
					se.embedding::text as embedding,
					se.model,
					se.model_version
				from public.song_embedding se
				where se.song_id = s.id
					and se.kind = 'full'
					and se.dims = ${EMBEDDING_DIMENSIONS}
				order by se.created_at desc, se.id desc
				limit 1
			) e on true
			where ls.account_id = ${account.id}
				and ls.unliked_at is null
			order by s.id
		`;
		return { account, rows };
	});
}

async function main(): Promise<void> {
	const sql = postgres(LOCAL_DATABASE_URL, {
		max: 1,
		prepare: false,
		idle_timeout: 5,
	});

	try {
		console.error(`Loading ${ACCOUNT_NAME} from ${CONTAINER_NAME}...`);
		const { account, rows } = await loadLibrary(sql);
		const datasets = buildDatasets(rows);
		if (datasets.semantic.vectors.length < 2 || datasets.sonic.vectors.length < 2) {
			throw new Error("Not enough enriched liked songs to run both clustering probes.");
		}

		const semanticMaxK = Math.min(
			8,
			Math.floor(datasets.semantic.vectors.length / 75),
		);
		const sonicMaxK = Math.min(6, Math.floor(datasets.sonic.vectors.length / 100));
		if (semanticMaxK < 2 || sonicMaxK < 2) {
			throw new Error(
				`Not enough modality coverage for candidate k: semantic=${datasets.semantic.vectors.length}, sonic=${datasets.sonic.vectors.length}.`,
			);
		}

		console.error(
			`Clustering semantic (${datasets.semantic.vectors.length} songs, k=2..${semanticMaxK})...`,
		);
		const semantic = analyzeModality({
			name: "Semantic",
			dataset: datasets.semantic,
			maxK: semanticMaxK,
			minClusterSize: 25,
			restarts: 5,
			seedSalt: 0x53_45_4d,
			note: "Embeddings are clustered independently of audio features; songs without a usable latest 512-dimensional full embedding are excluded from this modality.",
		});

		console.error(
			`Clustering sonic (${datasets.sonic.vectors.length} songs, k=2..${sonicMaxK})...`,
		);
		const sonic = analyzeModality({
			name: "Sonic",
			dataset: datasets.sonic,
			maxK: sonicMaxK,
			minClusterSize: 30,
			restarts: 10,
			seedSalt: 0x53_4f_4e,
			note: "Only songs with all nine finite audio features are included, so missing values are not imputed into the sonic geometry.",
		});

		const report = renderReport({
			account,
			rows,
			models: datasets.models,
			semantic,
			sonic,
		});
		await mkdir(dirname(REPORT_PATH), { recursive: true });
		await writeFile(REPORT_PATH, report, "utf8");
		process.stdout.write(report);
		console.error(`Wrote ${REPORT_PATH}`);
	} finally {
		await sql.end({ timeout: 5 });
	}
}

main().catch((error) => {
	console.error(
		`Vibe probe failed. Ensure ${CONTAINER_NAME} is running on localhost:54322.`,
	);
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
