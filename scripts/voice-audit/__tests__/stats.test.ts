import { describe, expect, it } from "vitest";
import type { ConceptRead } from "@/lib/domains/enrichment/content-analysis/concept-schema";
import {
	analysisProse,
	burstinessStats,
	functionWordRatio,
	mtld,
	voiceStats,
} from "../stats";

const fixture: ConceptRead = {
	image: "IMAGE",
	lens: "LENS",
	tension: "TENSION",
	take: "TAKETEXT",
	contradiction: "CONTRA",
	arc: [{ label: "LBL", mood: "MD", scene: "SCENETEXT" }],
	lines: [{ line: "QUOTEDLYRIC" }],
	texture: "TEXTURE",
};

describe("functionWordRatio", () => {
	it("counts closed-class words against the total", () => {
		// the, and, the -> 3 of 5
		expect(functionWordRatio("the cat and the dog")).toBeCloseTo(0.6, 5);
	});
	it("returns null for empty text", () => {
		expect(functionWordRatio("")).toBeNull();
	});
});

describe("burstinessStats", () => {
	it("scores metronomic sentences near -1", () => {
		const s = burstinessStats("one two three. four five six. seven eight nine.");
		expect(s.sentences).toBe(3);
		expect(s.burstiness).toBeCloseTo(-1, 5);
	});
	it("scores varied sentence lengths higher than uniform ones", () => {
		const uniform = burstinessStats("a b c. d e f. g h i.");
		const varied = burstinessStats("short. now a much longer sentence with many more words here.");
		expect(varied.burstiness as number).toBeGreaterThan(uniform.burstiness as number);
	});
});

describe("mtld", () => {
	it("returns null below the minimum token count", () => {
		expect(mtld("too short to measure")).toBeNull();
	});
	it("rates diverse vocabulary above repetitive vocabulary", () => {
		const repetitive = `${"the cat sat on the mat ".repeat(20)}`;
		const diverse =
			"quiet rivers wind through ancient valleys while distant thunder rolls over jagged peaks and migrating cranes trace silver arcs against a bruised autumn sky above the sleeping orchard town below the ridge line where foxes prowl beneath crooked pines and lanterns flicker softly inside weathered cottages whose chimneys exhale thin ribbons of woodsmoke into the gathering violet dusk that settles gently across frostbitten meadows";
		const r = mtld(repetitive);
		const d = mtld(diverse);
		expect(r).not.toBeNull();
		expect(d).not.toBeNull();
		expect(d as number).toBeGreaterThan(r as number);
	});
});

describe("analysisProse", () => {
	it("includes model prose but excludes quoted lyric lines", () => {
		const prose = analysisProse(fixture);
		expect(prose).toContain("TAKETEXT");
		expect(prose).toContain("SCENETEXT");
		expect(prose).not.toContain("QUOTEDLYRIC");
	});
});

describe("voiceStats", () => {
	it("reports all metrics over the prose", () => {
		const s = voiceStats(fixture);
		expect(s.wordCount).toBeGreaterThan(0);
		expect(s.burstiness.sentences).toBeGreaterThanOrEqual(1);
	});
});
