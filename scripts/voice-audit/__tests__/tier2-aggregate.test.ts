import { describe, expect, it } from "vitest";
import {
	collapseOutcome,
	EVAL_ARTIFACT_SCHEMA_VERSION,
	type EvalArtifact,
	type EvalRunVerdict,
	type EvalSongRecord,
	type JudgeFindingRecord,
	type RunOutcome,
} from "../eval-artifact";
import {
	hasPointwise,
	judgePassRateDiff,
	judgePassRates,
	JUDGE_ORDER,
	qualitativeDigest,
} from "../tier2-aggregate";

interface RunOpts {
	tier2?: JudgeFindingRecord[];
	pairwiseRationales?: string[];
}

function run(outcome: RunOutcome, opts: RunOpts = {}): EvalRunVerdict {
	return {
		runId: `run-${outcome}`,
		outcome,
		confidence: "high",
		agreement: true,
		candidateWordCount: 100,
		tier1: { high: 0, medium: 0, low: 0 },
		...(opts.pairwiseRationales ? { pairwiseRationales: opts.pairwiseRationales } : {}),
		...(opts.tier2 ? { tier2: opts.tier2 } : {}),
	};
}

function pass(judge: string): JudgeFindingRecord {
	return { judge, passed: true, evidence: [] };
}

function fail(judge: string, evidence: string[], rationale?: string): JudgeFindingRecord {
	return { judge, passed: false, evidence, rationale };
}

function song(key: string, runs: EvalRunVerdict[]): EvalSongRecord {
	return {
		key,
		song: key,
		spotifyTrackId: key,
		goldWordCount: 100,
		runs,
		songOutcome: collapseOutcome(runs),
	};
}

function artifact(label: string, songs: EvalSongRecord[]): EvalArtifact {
	return {
		schemaVersion: EVAL_ARTIFACT_SCHEMA_VERSION,
		label,
		variant: { promptVersion: "17", model: "gemini", temperature: 0.3 },
		judgeModel: "opus",
		generatedAt: "2026-06-06T00:00:00.000Z",
		songs,
	};
}

describe("hasPointwise", () => {
	it("is true when any run carries tier-2 findings", () => {
		const a = artifact("v17", [song("s1", [run("WIN", { tier2: [pass("grounding")] })])]);
		expect(hasPointwise(a)).toBe(true);
	});

	it("is false for a statistical-only (legacy) artifact", () => {
		const a = artifact("v13", [song("s1", [run("WIN"), run("LOSS")])]);
		expect(hasPointwise(a)).toBe(false);
	});
});

describe("judgePassRates", () => {
	it("counts passes over candidates and lists grounding first", () => {
		const a = artifact("v17", [
			song("s1", [
				run("WIN", { tier2: [pass("grounding"), fail("redundancy", ["a/b"])] }),
				run("WIN", { tier2: [fail("grounding", ["imported fact"]), pass("redundancy")] }),
			]),
			song("s2", [run("LOSS", { tier2: [pass("grounding"), pass("redundancy")] })]),
		]);
		const rates = judgePassRates(a);
		// Canonical order: grounding leads, then the rest by JUDGE_ORDER.
		expect(rates.map((r) => r.judge)).toEqual(["grounding", "redundancy"]);
		const grounding = rates.find((r) => r.judge === "grounding");
		expect(grounding).toMatchObject({ passed: 2, total: 3 });
		expect(grounding?.rate).toBeCloseTo(2 / 3, 10);
	});

	it("appends an unknown judge after the canonical ones rather than dropping it", () => {
		const a = artifact("v17", [
			song("s1", [run("WIN", { tier2: [pass("voice-softness"), pass("made-up-judge")] })]),
		]);
		const order = judgePassRates(a).map((r) => r.judge);
		expect(order.indexOf("voice-softness")).toBeLessThan(order.indexOf("made-up-judge"));
		expect(order).toContain("made-up-judge");
	});

	it("keeps every canonical judge name resolvable", () => {
		// Guards against a typo drift between JUDGE_ORDER and the live judge.ts registrations.
		expect(JUDGE_ORDER).toContain("grounding");
		expect(JUDGE_ORDER.length).toBe(8);
	});
});

describe("qualitativeDigest", () => {
	it("groups failed-judge evidence worst-first and dedupes", () => {
		const a = artifact("v17", [
			song("s1", [
				run("LOSS", {
					tier2: [fail("grounding", ["imported chart fact"], "reception not in lyrics")],
				}),
				run("LOSS", { tier2: [fail("grounding", ["imported chart fact"])] }), // dup evidence
			]),
			song("s2", [run("WIN", { tier2: [fail("redundancy", ["scene repeats take"])] })]),
		]);
		const d = qualitativeDigest(a);
		expect(d.byJudge[0].judge).toBe("grounding"); // 2 failures > redundancy's 1
		expect(d.byJudge[0].failures).toBe(2);
		// Dedupe across the two identical evidence strings, and surface the rationale.
		expect(d.byJudge[0].evidence).toContain("imported chart fact");
		expect(d.byJudge[0].evidence.filter((e) => e === "imported chart fact")).toHaveLength(1);
		expect(d.byJudge[0].evidence.some((e) => e.startsWith("(why)"))).toBe(true);
	});

	it("collects pairwise rationales only from non-winning runs", () => {
		const a = artifact("v17", [
			song("s1", [run("WIN", { pairwiseRationales: ["won: vivid and specific"] })]),
			song("s2", [run("LOSS", { pairwiseRationales: ["lost: generic abstractions"] })]),
			song("s3", [run("TIE", { pairwiseRationales: ["tie: both fine"] })]),
		]);
		const d = qualitativeDigest(a);
		expect(d.totalNonWinning).toBe(2); // LOSS + TIE, never the WIN
		expect(d.losingRationales.map((r) => r.rationale)).toEqual([
			"lost: generic abstractions",
			"tie: both fine",
		]);
	});

	it("respects the rationale cap while preserving the true denominator", () => {
		const songs = Array.from({ length: 5 }, (_, i) =>
			song(`s${i}`, [run("LOSS", { pairwiseRationales: [`lost ${i}`] })]),
		);
		const d = qualitativeDigest(artifact("v17", songs), { maxRationales: 2 });
		expect(d.losingRationales).toHaveLength(2);
		expect(d.totalNonWinning).toBe(5); // cap never hides the real count
	});
});

describe("judgePassRateDiff", () => {
	it("reports b − a per judge", () => {
		const a = artifact("A", [
			song("s1", [run("WIN", { tier2: [fail("grounding", ["x"]), pass("redundancy")] })]),
		]);
		const b = artifact("B", [
			song("s1", [run("WIN", { tier2: [pass("grounding"), pass("redundancy")] })]),
		]);
		const diff = judgePassRateDiff(a, b);
		const grounding = diff.find((d) => d.judge === "grounding");
		expect(grounding?.a).toBe(0);
		expect(grounding?.b).toBe(1);
		expect(grounding?.delta).toBe(1);
	});

	it("nulls the delta when a judge ran on only one side", () => {
		const a = artifact("A", [song("s1", [run("WIN", { tier2: [pass("grounding")] })])]);
		const b = artifact("B", [
			song("s1", [run("WIN", { tier2: [pass("grounding"), pass("voice-softness")] })]),
		]);
		const vs = judgePassRateDiff(a, b).find((d) => d.judge === "voice-softness");
		expect(vs?.a).toBeNull();
		expect(vs?.delta).toBeNull();
	});
});
