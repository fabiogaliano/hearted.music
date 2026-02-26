import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { AnalysisRun } from "./report";

function songKey(artist: string, title: string): string {
	return `${artist}--${title}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
}

function modelDir(cacheDir: string, model: string): string {
	return join(cacheDir, "results", model);
}

function variantDir(cacheDir: string, model: string, variantId: string): string {
	return join(modelDir(cacheDir, model), variantId);
}

function resultPath(
	cacheDir: string,
	model: string,
	variantId: string,
	artist: string,
	title: string,
): string {
	return join(
		variantDir(cacheDir, model, variantId),
		`${songKey(artist, title)}.json`,
	);
}

export function saveResult(cacheDir: string, model: string, result: AnalysisRun): void {
	const dir = variantDir(cacheDir, model, result.variantId);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

	const path = resultPath(
		cacheDir,
		model,
		result.variantId,
		result.song.artist,
		result.song.title,
	);
	writeFileSync(path, JSON.stringify(result, null, "\t"));
}

export function loadResult(
	cacheDir: string,
	model: string,
	variantId: string,
	artist: string,
	title: string,
): AnalysisRun | null {
	const path = resultPath(cacheDir, model, variantId, artist, title);
	try {
		if (existsSync(path)) {
			return JSON.parse(readFileSync(path, "utf-8")) as AnalysisRun;
		}
	} catch {
		// Corrupt file, treat as cache miss
	}
	return null;
}

export function loadAllResults(cacheDir: string, model: string): AnalysisRun[] {
	const results: AnalysisRun[] = [];
	const dir = modelDir(cacheDir, model);
	if (!existsSync(dir)) return results;

	for (const entry of readdirSync(dir)) {
		const entryPath = join(dir, entry);
		if (!statSync(entryPath).isDirectory()) continue;

		for (const file of readdirSync(entryPath)) {
			if (!file.endsWith(".json")) continue;
			try {
				const data = JSON.parse(
					readFileSync(join(entryPath, file), "utf-8"),
				);
				results.push(data);
			} catch {
				// Skip corrupt files
			}
		}
	}

	return results;
}

export function loadResultsForVariants(
	cacheDir: string,
	model: string,
	variantIds: string[],
): AnalysisRun[] {
	const results: AnalysisRun[] = [];

	for (const variantId of variantIds) {
		const dir = variantDir(cacheDir, model, variantId);
		if (!existsSync(dir)) continue;

		for (const file of readdirSync(dir)) {
			if (!file.endsWith(".json")) continue;
			try {
				const data = JSON.parse(
					readFileSync(join(dir, file), "utf-8"),
				);
				results.push(data);
			} catch {
				// Skip corrupt files
			}
		}
	}

	return results;
}

export function listCachedVariants(cacheDir: string, model: string): string[] {
	const dir = modelDir(cacheDir, model);
	if (!existsSync(dir)) return [];

	return readdirSync(dir).filter((entry) =>
		statSync(join(dir, entry)).isDirectory(),
	);
}
