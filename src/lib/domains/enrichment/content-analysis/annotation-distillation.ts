/**
 * Annotation distillation: compress each distinct Genius annotation in a lyrics
 * document to its grounding facts, cached on (content_hash, distiller_version) so the
 * work happens once per annotation across the whole catalog.
 *
 * Returns Map<normalizedText, distilledText> — keyed the same way the formatter dedups,
 * so formatLyricsCompact can substitute distilled text synchronously. It NEVER throws:
 * on any failure it returns whatever was cached and the formatter falls back to raw text
 * per annotation. Distillation is an optimization over raw grounding, never a hard
 * dependency of analysis.
 *
 * The generator consumes the distilled text; the grounding judge keeps reading the RAW
 * annotation, so it stays the QA on the distiller — a hallucinated fact is caught
 * downstream because it isn't in the source.
 */

import { Result } from "better-result";
import type { TransformedLyricsBySection } from "@/lib/domains/enrichment/lyrics/types/lyrics.types";
import { normalizeAnnotationText } from "@/lib/domains/enrichment/lyrics/utils/lyrics-formatter";
import { createLlmService } from "@/lib/integrations/llm/service";
import {
	type AnnotationDistillationRow,
	getAnnotationDistillations,
	upsertAnnotationDistillations,
} from "./annotation-distillation-queries";
import { hashAnnotationText } from "./annotation-hash";
import { recordLlmUsage } from "./llm-usage-queries";
import { distillAnnotationPrompt } from "./prompts/distill";

// Bump to invalidate the cache when the prompt or model below changes.
const DISTILLER_VERSION = "v2";
const DISTILLER_PROVIDER = "google-vertex" as const;
// Flash-Lite: most faithful budget extractor on the hallucination leaderboard, and the
// task is faithful extraction, not generation. One-time/cached so cost is negligible.
const DISTILLER_MODEL = "gemini-2.5-flash-lite";
const DISTILL_MAX_OUTPUT_TOKENS = 256;

interface UniqueAnnotation {
	normalized: string;
	raw: string;
	hash: string;
}

/** One entry per distinct annotation text. */
function collectUnique(
	sections: TransformedLyricsBySection[],
): Map<string, { raw: string }> {
	const unique = new Map<string, { raw: string }>();
	for (const section of sections) {
		for (const line of section.lines) {
			for (const annotation of line.annotations ?? []) {
				const normalized = normalizeAnnotationText(annotation.text);
				if (normalized.length === 0 || unique.has(normalized)) continue;
				unique.set(normalized, { raw: annotation.text });
			}
		}
	}
	return unique;
}

export async function ensureAnnotationDistillations(
	sections: TransformedLyricsBySection[],
): Promise<Map<string, string>> {
	const unique = collectUnique(sections);
	if (unique.size === 0) return new Map();

	const entries: UniqueAnnotation[] = await Promise.all(
		[...unique].map(async ([normalized, { raw }]) => ({
			normalized,
			raw,
			hash: await hashAnnotationText(normalized),
		})),
	);

	const result = new Map<string, string>();
	const cached = await getAnnotationDistillations(
		entries.map((e) => e.hash),
		DISTILLER_VERSION,
	);
	const cachedByHash = new Map<string, string>();
	if (Result.isOk(cached)) {
		for (const row of cached.value) {
			cachedByHash.set(row.content_hash, row.distilled_text);
		}
	}

	const misses: UniqueAnnotation[] = [];
	for (const entry of entries) {
		const hit = cachedByHash.get(entry.hash);
		if (hit !== undefined) {
			result.set(entry.normalized, hit);
		} else {
			misses.push(entry);
		}
	}
	if (misses.length === 0) return result;

	// Only the LLM step can throw (e.g. provider unconfigured). Isolate it so cached hits
	// survive and misses simply fall back to raw text in the formatter.
	try {
		const llm = createLlmService(DISTILLER_PROVIDER, DISTILLER_MODEL);
		const distilled = await Promise.all(
			misses.map(async (entry) => {
				const generated = await llm.generateText(
					distillAnnotationPrompt(entry.raw),
					{
						functionId: "annotation-distill",
						maxOutputTokens: DISTILL_MAX_OUTPUT_TOKENS,
					},
				);
				if (Result.isError(generated)) return null;
				const text = generated.value.text.trim();
				if (text.length === 0) return null;
				return {
					entry,
					text,
					model: generated.value.model,
					modelId: generated.value.modelId,
					provider: generated.value.provider,
					tokens: generated.value.tokens,
					costUsd: generated.value.costUsd,
				};
			}),
		);

		const rows: AnnotationDistillationRow[] = [];
		for (const item of distilled) {
			if (!item) continue;
			result.set(item.entry.normalized, item.text);
			rows.push({
				content_hash: item.entry.hash,
				distiller_version: DISTILLER_VERSION,
				raw_text: item.entry.raw,
				distilled_text: item.text,
				model: item.model,
			});
		}
		if (rows.length > 0) {
			const saved = await upsertAnnotationDistillations(rows);
			if (Result.isError(saved)) {
				console.warn(
					`[AnnotationDistillation] cache write failed: ${saved.error.message}`,
				);
			}
		}

		// Ledger spend: one row per freshly distilled annotation (cache hits made no call,
		// so they get no row — keyed by content_hash, not song). Best-effort, like the cache
		// write above; a failed ledger insert is logged and never throws.
		await Promise.all(
			distilled.map(async (item) => {
				if (!item) return;
				const recorded = await recordLlmUsage({
					functionId: "annotation-distillation",
					contentHash: item.entry.hash,
					provider: item.provider,
					model: item.modelId,
					tokens: item.tokens,
					costUsd: item.costUsd,
					promptVersion: DISTILLER_VERSION,
				});
				if (Result.isError(recorded)) {
					console.warn(
						`[llm-usage] failed to record annotation-distillation for ${item.entry.hash}: ${recorded.error.message}`,
					);
				}
			}),
		);
	} catch (error) {
		console.warn(
			`[AnnotationDistillation] distillation step failed: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	return result;
}
