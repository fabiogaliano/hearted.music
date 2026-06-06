import { describe, expect, it } from "vitest";
import { getLyricalPrompt } from "@/lib/domains/enrichment/content-analysis/prompts/registry";
import { renderAnnotationsBlockForPrompt } from "@/lib/domains/enrichment/content-analysis/grounding-annotations";
import { loadGoldExemplars, renderExemplarBlock } from "../exemplars";
import { EXAMPLE_COUNT, EXEMPLAR_POOL_KEYS, selectExemplars } from "../regen";

const byKey = new Map(
	[...loadGoldExemplars().values()].map((g) => [g.key, g] as const),
);

describe("v17 prompt slots", () => {
	it("registers v17 with both runtime-injection slots", () => {
		const p = getLyricalPrompt("17");
		expect(p.version).toBe("17");
		expect(p.template).toContain("{example}");
		expect(p.template).toContain("{annotations}");
	});

	it("bakes no exemplar JSON into the template", () => {
		// The slots are filled at call time; no gold prose may live in the prompt file.
		const p = getLyricalPrompt("17");
		expect(p.template).not.toContain("WORKED EXAMPLES");
	});
});

describe("selectExemplars (leave-one-out)", () => {
	it("never injects a song's own gold and returns the locked count", () => {
		for (const g of byKey.values()) {
			const picks = selectExemplars(g.key, byKey);
			expect(picks).toHaveLength(EXAMPLE_COUNT);
			expect(picks.map((p) => p.key)).not.toContain(g.key);
			for (const p of picks) expect(EXEMPLAR_POOL_KEYS).toContain(p.key);
		}
	});

	it("drops the matching pool entry and falls through to the next", () => {
		expect(selectExemplars("not-like-us", byKey).map((p) => p.key)).toEqual([
			"pink-pony-club",
			"motion-sickness",
		]);
		expect(selectExemplars("pink-pony-club", byKey).map((p) => p.key)).toEqual([
			"not-like-us",
			"motion-sickness",
		]);
	});

	it("uses the fixed prod pair for a song outside the pool", () => {
		expect(selectExemplars("dtmf", byKey).map((p) => p.key)).toEqual([
			"not-like-us",
			"pink-pony-club",
		]);
	});
});

describe("renderExemplarBlock", () => {
	const golds = [...byKey.values()];

	it("returns empty string for no examples (empty-safe slot)", () => {
		expect(renderExemplarBlock([])).toBe("");
	});

	it("renders a numbered block carrying each example's song and lens", () => {
		const block = renderExemplarBlock(golds.slice(0, 2));
		expect(block).toContain("WORKED EXAMPLES");
		expect(block).toContain(`EXAMPLE 1 — ${golds[0].song}`);
		expect(block).toContain(`EXAMPLE 2 — ${golds[1].song}`);
		expect(block).toContain(golds[0].read.lens);
		expect(block).toContain(golds[0].read.take);
	});
});

describe("renderAnnotationsBlockForPrompt", () => {
	it("collapses an empty block to the empty string", () => {
		expect(renderAnnotationsBlockForPrompt("")).toBe("");
		expect(renderAnnotationsBlockForPrompt("   \n  ")).toBe("");
	});

	it("frames a non-empty block as trusted grounding", () => {
		const out = renderAnnotationsBlockForPrompt('[Verse 1] "a line"\n  (42 votes) a note');
		expect(out).toContain("vote gate");
		expect(out).toContain("(42 votes) a note");
	});
});
