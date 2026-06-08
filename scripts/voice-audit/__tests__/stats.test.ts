import { describe, expect, it } from "vitest";
import type { SongRead } from "@/lib/domains/enrichment/content-analysis/read-schema";
import {
	analysisProse,
	burstinessStats,
	functionWordRatio,
	mcnemarMidP,
	mtld,
	voiceStats,
	wilsonInterval,
} from "../stats";

const fixture: SongRead = {
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

describe("wilsonInterval", () => {
	it("returns the full [0,1] band when n=0", () => {
		expect(wilsonInterval(0, 0)).toEqual({ lo: 0, hi: 1 });
	});

	it("clamps the upper bound at 1 for a perfect proportion", () => {
		// 9/9 at 95%: the classic Wilson band is roughly [0.701, 1.0]; the upper bound is
		// clamped because the score interval would otherwise nudge just past 1.
		const ci = wilsonInterval(9, 9);
		expect(ci.lo).toBeCloseTo(0.701, 2);
		expect(ci.hi).toBe(1);
	});

	it("brackets the point estimate symmetrically inward at n=9", () => {
		// 5/9 = 0.556. Wilson pulls the center toward 0.5 and the band is wide at n=9.
		const ci = wilsonInterval(5, 9);
		expect(ci.lo).toBeCloseTo(0.267, 2);
		expect(ci.hi).toBeCloseTo(0.811, 2);
	});

	it("floors the lower bound at 0 for a zero proportion", () => {
		const ci = wilsonInterval(0, 9);
		expect(ci.lo).toBe(0);
		expect(ci.hi).toBeCloseTo(0.299, 2);
	});

	it("widens as n shrinks for the same proportion", () => {
		const wide = wilsonInterval(1, 3);
		const narrow = wilsonInterval(10, 30);
		expect(wide.hi - wide.lo).toBeGreaterThan(narrow.hi - narrow.lo);
	});
});

describe("mcnemarMidP", () => {
	it("returns p=1 when there is no discordance", () => {
		expect(mcnemarMidP(0, 0)).toEqual({ p: 1, b: 0, c: 0 });
	});

	it("returns p=1 for a symmetric split", () => {
		expect(mcnemarMidP(5, 5).p).toBeCloseTo(1, 10);
	});

	it("is significant for a clean same-direction flip", () => {
		// b=9, c=0 over 9 discordant songs: one-sided mid-p = 0.5 * 0.5^9, two-sided = 1/512.
		const r = mcnemarMidP(9, 0);
		expect(r.p).toBeCloseTo(1 / 512, 10);
		expect(r.b).toBe(9);
		expect(r.c).toBe(0);
	});

	it("matches the hand-computed mid-p for 8 vs 1", () => {
		// mid-p two-sided = exact(0.0390625) − point mass at boundary (9/512) = 11/512.
		expect(mcnemarMidP(8, 1).p).toBeCloseTo(11 / 512, 10);
	});

	it("is order-independent in the p-value", () => {
		expect(mcnemarMidP(7, 2).p).toBeCloseTo(mcnemarMidP(2, 7).p, 12);
	});
});
