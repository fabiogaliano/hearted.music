import { describe, expect, it } from "vitest";
import {
	collapseOutcome,
	EVAL_ARTIFACT_SCHEMA_VERSION,
	type EvalArtifact,
	type EvalRunVerdict,
	type EvalSongRecord,
	type RunOutcome,
} from "../eval-artifact";
import {
	lengthEffect,
	marginalSummary,
	pairedDiscordance,
} from "../scoreboard";

function run(outcome: RunOutcome, candidateWordCount = 100): EvalRunVerdict {
	return {
		runId: `run-${outcome}-${candidateWordCount}`,
		outcome,
		confidence: "high",
		agreement: true,
		candidateWordCount,
		tier1: { high: 0, medium: 0, low: 0 },
	};
}

function song(
	key: string,
	outcomes: RunOutcome[],
	opts: { goldWordCount?: number; candidateWordCount?: number } = {},
): EvalSongRecord {
	const runs = outcomes.map((o) => run(o, opts.candidateWordCount ?? 100));
	return {
		key,
		song: key,
		spotifyTrackId: key,
		goldWordCount: opts.goldWordCount ?? 100,
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

describe("collapseOutcome", () => {
	it("treats WIN or TIE as the success class", () => {
		expect(collapseOutcome([run("WIN"), run("TIE"), run("WIN")])).toBe("success");
		expect(collapseOutcome([run("WIN"), run("TIE"), run("LOSS")])).toBe("success");
	});

	it("fails on a LOSS majority", () => {
		expect(collapseOutcome([run("LOSS"), run("LOSS"), run("WIN")])).toBe("fail");
	});

	it("is indeterminate on an even split (legacy 2-run data)", () => {
		expect(collapseOutcome([run("WIN"), run("LOSS")])).toBe("indeterminate");
	});

	it("is indeterminate with no runs", () => {
		expect(collapseOutcome([])).toBe("indeterminate");
	});

	it("never produces an even split with an odd run count", () => {
		// The whole point of the odd-run rule: a 3-run song always has a majority.
		for (const outcomes of [
			["WIN", "LOSS", "TIE"],
			["LOSS", "LOSS", "TIE"],
			["WIN", "WIN", "LOSS"],
		] as RunOutcome[][]) {
			expect(collapseOutcome(outcomes.map((o) => run(o)))).not.toBe("indeterminate");
		}
	});
});

describe("marginalSummary", () => {
	it("counts WIN-or-TIE songs as successes over the determinate n", () => {
		const a = artifact("v17", [
			song("s1", ["WIN", "WIN", "WIN"]),
			song("s2", ["TIE", "WIN", "TIE"]),
			song("s3", ["LOSS", "LOSS", "WIN"]),
			song("s4", ["WIN", "LOSS"]), // even split → indeterminate, excluded
		]);
		const m = marginalSummary(a);
		expect(m.successes).toBe(2);
		expect(m.determinate).toBe(3);
		expect(m.indeterminate).toBe(1);
		expect(m.total).toBe(4);
		expect(m.rate).toBeCloseTo(2 / 3, 10);
		// Wilson band must contain the point estimate and stay within [0,1].
		expect(m.wilson.lo).toBeGreaterThanOrEqual(0);
		expect(m.wilson.hi).toBeLessThanOrEqual(1);
		expect(m.wilson.lo).toBeLessThan(m.rate as number);
		expect(m.wilson.hi).toBeGreaterThan(m.rate as number);
	});
});

describe("pairedDiscordance", () => {
	const a = artifact("A", [
		song("s1", ["WIN", "WIN", "WIN"]), // success
		song("s2", ["WIN", "WIN", "WIN"]), // success
		song("s3", ["LOSS", "LOSS", "LOSS"]), // fail
		song("s4", ["WIN", "WIN", "WIN"]), // success
		song("s5", ["WIN", "LOSS"]), // indeterminate
	]);
	const b = artifact("B", [
		song("s1", ["WIN", "WIN", "WIN"]), // success → both success
		song("s2", ["LOSS", "LOSS", "LOSS"]), // fail → A>B (b)
		song("s3", ["LOSS", "LOSS", "LOSS"]), // fail → both fail
		song("s4", ["WIN", "WIN", "WIN"]), // success → both success
		song("s5", ["WIN", "WIN", "WIN"]), // success but A indeterminate → excluded
	]);

	it("computes discordant cells from the paired song outcomes", () => {
		const d = pairedDiscordance(a, b);
		expect(d.b).toBe(1); // s2: A success, B fail
		expect(d.c).toBe(0);
		expect(d.bothSuccess).toBe(2); // s1, s4
		expect(d.bothFail).toBe(1); // s3
		expect(d.paired).toBe(4);
		expect(d.excluded).toBe(1); // s5 indeterminate in A
	});

	it("ignores songs missing from the other variant", () => {
		const onlyB = artifact("B", [song("zzz", ["WIN", "WIN", "WIN"])]);
		const d = pairedDiscordance(a, onlyB);
		expect(d.paired).toBe(0);
		expect(d.perSong).toEqual([]);
	});
});

describe("lengthEffect", () => {
	it("flags a positive correlation when wins skew long", () => {
		const a = artifact("v17", [
			song("s1", ["WIN", "WIN", "WIN"], { goldWordCount: 100, candidateWordCount: 160 }),
			song("s2", ["WIN", "WIN", "WIN"], { goldWordCount: 100, candidateWordCount: 150 }),
			song("s3", ["LOSS", "LOSS", "LOSS"], { goldWordCount: 100, candidateWordCount: 90 }),
			song("s4", ["LOSS", "LOSS", "LOSS"], { goldWordCount: 100, candidateWordCount: 95 }),
		]);
		const e = lengthEffect(a);
		expect(e.meanDeltaSuccess).toBeGreaterThan(e.meanDeltaFail as number);
		expect(e.correlation).not.toBeNull();
		expect(e.correlation as number).toBeGreaterThan(0.5);
	});

	it("returns null correlation when every song shares an outcome", () => {
		const a = artifact("v17", [
			song("s1", ["WIN", "WIN", "WIN"], { candidateWordCount: 120 }),
			song("s2", ["WIN", "WIN", "WIN"], { candidateWordCount: 200 }),
		]);
		expect(lengthEffect(a).correlation).toBeNull();
	});
});
