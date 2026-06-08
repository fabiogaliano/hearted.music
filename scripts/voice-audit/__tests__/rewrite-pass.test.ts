import { describe, expect, it } from "vitest";
import type { SongRead } from "@/lib/domains/enrichment/content-analysis/read-schema";
import { applySurgical, buildRewritePrompt } from "../rewrite/rewrite-pass";
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
