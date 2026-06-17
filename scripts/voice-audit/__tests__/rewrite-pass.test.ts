import { Result } from "better-result";
import { describe, expect, it } from "vitest";
import type { SongRead } from "@/lib/domains/enrichment/content-analysis/read-schema";
import {
	applySurgical,
	buildRewriteOutputSchema,
	buildRewritePrompt,
	rewriteRead,
} from "@/lib/domains/enrichment/content-analysis/voice/rewrite-pass";
import type { RuleHit } from "../types";

// applySurgical is the content-fidelity invariant of the rewrite pass: the model may only ever
// change a flagged prose field; everything else is pinned from the original. These tests lock that
// guarantee so a future prompt/loop change can't silently let the model drift content or invent a
// contradiction/texture.

const original: SongRead = {
	lens: "a milestone as a funeral",
	tension: "Quiet Grief",
	image: "driving alone past your street",
	take: "She drives through the suburbs, reliving every memory.",
	contradiction: null,
	arc: [
		{ label: "The Promise", mood: "Tender Hope", scene: "She gets her license, dreaming of his house." },
		{ label: "The Reality", mood: "Sharp Loss", scene: "The freedom is a lie, leaving her alone." },
	],
	lines: [{ line: "red light, stop sign" }],
	texture: null,
};

// A model output that, if trusted wholesale, would corrupt the read: it rewrites every field,
// invents a contradiction and texture, drops a line, and shuffles the arc labels/moods.
const adversarialModelOut: SongRead = {
	lens: "WRONG LENS",
	tension: "WRONG TENSION",
	image: "WRONG IMAGE",
	take: "She drives through the suburbs. She relives every memory.",
	contradiction: "an invented contradiction",
	arc: [
		{ label: "BAD", mood: "BAD", scene: "She gets her license. She dreams of his house." },
		{ label: "BAD", mood: "BAD", scene: "beat 2" },
	],
	lines: [{ line: "DIFFERENT QUOTE" }],
	texture: "an invented texture",
};

describe("applySurgical", () => {
	it("pins lens, tension, and lines from the original regardless of model output", () => {
		const flagged = new Set(["take", "image", "arc[0].scene", "arc[1].scene"]);
		const out = applySurgical(original, original, adversarialModelOut, flagged);
		expect(out.lens).toBe(original.lens);
		expect(out.tension).toBe(original.tension);
		expect(out.lines).toEqual(original.lines);
	});

	it("keeps a null contradiction/texture null even when the model fills them", () => {
		const out = applySurgical(original, original, adversarialModelOut, new Set(["take"]));
		expect(out.contradiction).toBeNull();
		expect(out.texture).toBeNull();
	});

	it("takes the model's rewrite only for flagged fields, original for the rest", () => {
		// Only take + arc[0].scene flagged; image and arc[1].scene must stay original.
		const flagged = new Set(["take", "arc[0].scene"]);
		const out = applySurgical(original, original, adversarialModelOut, flagged);
		expect(out.take).toBe(adversarialModelOut.take);
		expect(out.arc[0].scene).toBe(adversarialModelOut.arc[0].scene);
		expect(out.image).toBe(original.image); // not flagged → original
		expect(out.arc[1].scene).toBe(original.arc[1].scene); // not flagged → original (no "beat 2")
	});

	it("preserves arc length, labels, and moods from the original", () => {
		const flagged = new Set(["arc[0].scene", "arc[1].scene"]);
		const out = applySurgical(original, original, adversarialModelOut, flagged);
		expect(out.arc).toHaveLength(original.arc.length);
		out.arc.forEach((b, i) => {
			expect(b.label).toBe(original.arc[i].label);
			expect(b.mood).toBe(original.arc[i].mood);
		});
	});

	it("falls back to the fed-in value when the model returns an empty flagged field", () => {
		const emptyModelOut: SongRead = { ...adversarialModelOut, take: "" };
		const out = applySurgical(original, original, emptyModelOut, new Set(["take"]));
		expect(out.take).toBe(original.take);
	});

	it("rewrites a fillable contradiction when it is non-null in the original and flagged", () => {
		const withContra: SongRead = { ...original, contradiction: "the old, flagged contradiction" };
		const modelOut: SongRead = { ...adversarialModelOut, contradiction: "a clean rewrite" };
		const out = applySurgical(withContra, withContra, modelOut, new Set(["contradiction"]));
		expect(out.contradiction).toBe("a clean rewrite");
	});
});

// The "direct-assertion" mode (Phase-4 H12) must swap ONLY the antithesis recipe to the
// delete-and-strengthen text; everything else, including the default "minimal" prompt, must be
// unchanged so the round-3b-validated pass keeps its behavior.
describe("buildRewritePrompt mode", () => {
	const antithesisHit: RuleHit = {
		rule: "antithesis",
		field: "take",
		span: "This is not a diss track. It is testifying.",
		severity: "high",
	};

	it("minimal mode uses the recast recipe, not the delete recipe, and no style-guide tags", () => {
		const prompt = buildRewritePrompt(original, [antithesisHit], "minimal");
		expect(prompt).toContain("drop the negated setup entirely");
		expect(prompt).not.toContain("DELETE the negated half entirely");
		expect(prompt).toContain("Change as little as possible");
		expect(prompt).not.toContain("master_prompt_override_style_guide");
	});

	it("direct-assertion mode swaps to the delete-and-strengthen recipe, wrapped in style-guide tags", () => {
		const prompt = buildRewritePrompt(original, [antithesisHit], "direct-assertion");
		expect(prompt).toContain("DELETE the negated half entirely");
		expect(prompt).toContain("never invent a new fact");
		expect(prompt).toContain("let the surviving claim stand on its own");
		expect(prompt).toContain("<master_prompt_override_style_guide>");
		expect(prompt).toContain("</master_prompt_override_style_guide>");
	});

	it("defaults to minimal mode when unspecified", () => {
		expect(buildRewritePrompt(original, [antithesisHit])).toBe(
			buildRewritePrompt(original, [antithesisHit], "minimal"),
		);
	});

	it("direct-assertion leaves a non-antithesis recipe identical to minimal", () => {
		const participialHit: RuleHit = {
			rule: "participial-closure",
			field: "take",
			span: "reliving every memory, deepening her grief",
			severity: "high",
		};
		expect(buildRewritePrompt(original, [participialHit], "direct-assertion")).toBe(
			buildRewritePrompt(original, [participialHit], "minimal"),
		);
	});
});

// The rewrite no longer asks the model to re-emit the whole read — only the flagged fields. These
// lock the schema↔prompt key agreement (the model must return exactly the flagged keys) and that the
// old whole-read instruction is gone, so a regression that re-bloats the output is caught.
describe("reduced rewrite output", () => {
	const twoFieldHits: RuleHit[] = [
		{ rule: "antithesis", field: "take", span: "x", severity: "high" },
		{
			rule: "participial-closure",
			field: "arc[1].scene",
			span: "y",
			severity: "high",
		},
	];

	it("schema requires exactly the flagged fields as keys", () => {
		const schema = buildRewriteOutputSchema(original, twoFieldHits);
		// arc[1].scene → "scene2" (1-based beat number); take → "take".
		expect(schema.safeParse({ take: "a", scene2: "b" }).success).toBe(true);
		expect(schema.safeParse({ take: "a" }).success).toBe(false); // scene2 missing
		// Unflagged fields are not part of the contract; extras are tolerated, not required.
		expect(schema.safeParse({}).success).toBe(false);
		expect(
			schema.safeParse({ take: "a", scene2: "b", image: "z" }).success,
		).toBe(true);
	});

	it("prompt lists exactly the flagged keys and drops the whole-read instruction", () => {
		const prompt = buildRewritePrompt(original, twoFieldHits);
		expect(prompt).toContain('- "take": the corrected take');
		expect(prompt).toContain(
			'- "scene2": the corrected scene prose for beat 2',
		);
		expect(prompt).toContain("Output JSON with exactly these keys");
		expect(prompt).not.toContain(
			"Return the corrected read as structured JSON with the same fields",
		);
		// Lines are shown for context now, never returned.
		expect(prompt).not.toContain("verbatim lyric quotes, return identical");
	});

	it("rejects target hits on fields the reduced output cannot represent", () => {
		const unsupportedHit: RuleHit = {
			rule: "antithesis",
			field: "lens",
			span: "x",
			severity: "high",
		};
		expect(() => buildRewriteOutputSchema(original, [unsupportedHit])).toThrow(
			"Rewrite pass cannot represent flagged fields in partial output: lens",
		);
		expect(() => buildRewritePrompt(original, [unsupportedHit])).toThrow(
			"Rewrite pass cannot represent flagged fields in partial output: lens",
		);
	});
});

// End-to-end: a fed-in read with one flagged field, a model that returns ONLY that field (the new
// wire format), must come out cleaned with every pinned field intact — including any junk the model
// puts on unflagged keys, which the merge ignores entirely.
describe("rewriteRead with partial model output", () => {
	const genResult = <T,>(output: T) =>
		Result.ok({
			output,
			model: "google-vertex:gemini-2.5-flash",
			modelId: "gemini-2.5-flash",
			provider: "google-vertex" as const,
			tokens: {
				prompt: 500,
				completion: 40,
				total: 540,
				cacheReadTokens: 0,
				reasoningTokens: 0,
			},
			costUsd: 0.0001,
		});

	// A base with NO target tells anywhere except the take we dirty, so exactly one field is flagged
	// and the pass runs exactly once. (The shared `original` fixture has participial closures in its
	// arc scenes, which would flag the scenes too and force a second pass.)
	const cleanBase: SongRead = {
		lens: "a milestone as a funeral",
		tension: "Quiet Grief",
		image: "a car on an empty road at dusk",
		take: "She drives past the old house and says nothing.",
		contradiction: null,
		arc: [
			{
				label: "The Promise",
				mood: "Tender Hope",
				scene: "She gets her license and dreams of his house.",
			},
			{
				label: "The Reality",
				mood: "Sharp Loss",
				scene: "The freedom turns out to be a lie and she sits alone.",
			},
		],
		lines: [{ line: "red light, stop sign" }],
		texture: null,
	};

	it("applies the rewritten flagged field and pins everything else", async () => {
		const dirty: SongRead = {
			...cleanBase,
			take: "This is not a diss track. It is testifying.",
		};
		const calls: Array<{
			schema: { safeParse: (value: unknown) => { success: boolean } };
		}> = [];
		const llm = {
			generateObject: async (
				_prompt: string,
				schema: { safeParse: (value: unknown) => { success: boolean } },
			) => {
				calls.push({ schema });
				return genResult({
					take: "It testifies.",
					lens: "WRONG",
					scene1: "WRONG",
				});
			},
		};
		const res = await rewriteRead(dirty, llm);

		expect(calls).toHaveLength(1); // the dirty take fired a target rule
		expect(res.passes).toBe(1);
		expect(res.read.take).toBe("It testifies.");
		expect(res.read.lens).toBe(cleanBase.lens); // junk lens ignored, pinned from original
		expect(res.read.arc[0].scene).toBe(cleanBase.arc[0].scene); // junk scene1 ignored, not flagged

		// The schema handed to the model required exactly the flagged key.
		const schemaArg = calls[0].schema;
		expect(schemaArg.safeParse({ take: "ok" }).success).toBe(true);
		expect(schemaArg.safeParse({}).success).toBe(false);
	});
});
