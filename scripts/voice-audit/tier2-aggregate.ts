// Aggregates the pointwise tier-2 findings persisted in an eval artifact into the descriptive
// signal the prompt loop reads: which judge keeps failing (pass-rates), WHAT keeps losing (the
// recurring judge evidence + pairwise rationales), and whether a named prior variant moved each
// judge (the diff). This is the qualitative half of the scorecard that the statistical scoreboard
// (Wilson/McNemar) deliberately left unbuilt.
//
// Everything here is pure and LLM-free: it reads only what evaluate.ts --pointwise already wrote.
// Pass-rates are DESCRIPTIVE counts over candidates (repeated measures), NOT inferential
// proportions — the only inferential unit at n=9 is the song-level WIN-or-TIE rate in
// scoreboard.ts, which is why no Wilson band lives here.

import type { EvalArtifact } from "./eval-artifact";

// Grounding leads — it is the priority-1 signal and the one miscalibration that would corrupt the
// whole loop. The rest follow the judge.ts registration order so the report reads predictably.
export const JUDGE_ORDER = [
	"grounding",
	"register-specificity",
	"abstract-noun-trap",
	"essayistic-register",
	"arc-narrative",
	"lens-coherence",
	"redundancy",
	"voice-softness",
] as const;

export function hasPointwise(artifact: EvalArtifact): boolean {
	return artifact.songs.some((s) => s.runs.some((r) => (r.tier2?.length ?? 0) > 0));
}

export interface PointwiseCoverage {
	/** Candidates carrying ≥1 tier-2 finding. */
	withTier2: number;
	/** All candidates (runs) in the artifact. */
	total: number;
	/** Every candidate was pointwise-judged, so each pass-rate denominator is the full candidate set. */
	complete: boolean;
}

// How many candidates actually carry pointwise findings versus the full candidate set. A --pointwise
// run that errored on some candidates (or a hand-merged artifact) leaves PARTIAL coverage: the
// per-judge pass-rates are then over a subset, not all candidates. The scoreboard surfaces this so a
// partial run is never read as full-coverage. (The judge totals already track each judge's own
// denominator; this is the candidate-level completeness the pass-rate header would otherwise imply.)
export function pointwiseCoverage(artifact: EvalArtifact): PointwiseCoverage {
	let withTier2 = 0;
	let total = 0;
	for (const song of artifact.songs) {
		for (const run of song.runs) {
			total++;
			if ((run.tier2?.length ?? 0) > 0) withTier2++;
		}
	}
	return { withTier2, total, complete: total > 0 && withTier2 === total };
}

export interface JudgePassRate {
	judge: string;
	passed: number;
	total: number;
	/** passed / total over candidates; null when the judge never ran. */
	rate: number | null;
}

// Order the judges canonically (grounding first), appending any judge name not in JUDGE_ORDER so a
// newly-added judge is surfaced rather than silently dropped.
function orderJudges(present: Set<string>): string[] {
	const ordered: string[] = [];
	const seen = new Set<string>();
	for (const j of JUDGE_ORDER) {
		if (present.has(j)) {
			ordered.push(j);
			seen.add(j);
		}
	}
	for (const j of present) {
		if (!seen.has(j)) ordered.push(j);
	}
	return ordered;
}

export function judgePassRates(artifact: EvalArtifact): JudgePassRate[] {
	const passed = new Map<string, number>();
	const total = new Map<string, number>();
	for (const song of artifact.songs) {
		for (const run of song.runs) {
			for (const f of run.tier2 ?? []) {
				total.set(f.judge, (total.get(f.judge) ?? 0) + 1);
				if (f.passed) passed.set(f.judge, (passed.get(f.judge) ?? 0) + 1);
			}
		}
	}
	return orderJudges(new Set(total.keys())).map((judge) => {
		const t = total.get(judge) ?? 0;
		const p = passed.get(judge) ?? 0;
		return { judge, passed: p, total: t, rate: t ? p / t : null };
	});
}

export interface JudgeEvidence {
	judge: string;
	failures: number;
	/** Deduped, capped sample of the evidence/rationale from this judge's failed findings. */
	evidence: string[];
}

export interface LosingRationale {
	key: string;
	outcome: "LOSS" | "TIE";
	rationale: string;
}

export interface QualitativeDigest {
	byJudge: JudgeEvidence[];
	losingRationales: LosingRationale[];
	/** Total non-winning runs seen, so a capped rationale list never reads as "only this many lost". */
	totalNonWinning: number;
}

function dedupeCap(items: string[], cap: number): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const raw of items) {
		const item = raw.trim();
		if (!item || seen.has(item)) continue;
		seen.add(item);
		out.push(item);
		if (out.length >= cap) break;
	}
	return out;
}

// The "what keeps losing" digest. Failed-judge evidence is collected per judge regardless of the
// pairwise outcome (a judge failure is a problem even on a win); pairwise rationales are collected
// only from runs that did NOT win (LOSS or TIE — anything short of beating gold tells the loop what
// to fix). Both are raw aggregation, not semantic clustering: the orchestrator reads the recurring
// phrasing itself. Caps keep the report scannable; totalNonWinning preserves the true denominator.
export function qualitativeDigest(
	artifact: EvalArtifact,
	opts: { maxEvidencePerJudge?: number; maxRationales?: number } = {},
): QualitativeDigest {
	const maxEvidencePerJudge = opts.maxEvidencePerJudge ?? 6;
	const maxRationales = opts.maxRationales ?? 10;

	const failures = new Map<string, number>();
	const evidence = new Map<string, string[]>();
	const losing: LosingRationale[] = [];
	let totalNonWinning = 0;

	for (const song of artifact.songs) {
		for (const run of song.runs) {
			for (const f of run.tier2 ?? []) {
				if (f.passed) continue;
				failures.set(f.judge, (failures.get(f.judge) ?? 0) + 1);
				const bucket = evidence.get(f.judge) ?? [];
				bucket.push(...f.evidence);
				if (f.rationale) bucket.push(`(why) ${f.rationale}`);
				evidence.set(f.judge, bucket);
			}
			if (run.outcome === "LOSS" || run.outcome === "TIE") {
				totalNonWinning++;
				for (const r of run.pairwiseRationales ?? []) {
					if (r?.trim()) {
						losing.push({ key: song.key, outcome: run.outcome, rationale: r.trim() });
					}
				}
			}
		}
	}

	const byJudge = orderJudges(new Set(failures.keys()))
		.map((judge) => ({
			judge,
			failures: failures.get(judge) ?? 0,
			evidence: dedupeCap(evidence.get(judge) ?? [], maxEvidencePerJudge),
		}))
		.sort((a, b) => b.failures - a.failures);

	return { byJudge, losingRationales: losing.slice(0, maxRationales), totalNonWinning };
}

export interface JudgePassRateDiff {
	judge: string;
	a: number | null;
	b: number | null;
	/** b − a; positive means the judge passed more often in B. null when either side never ran. */
	delta: number | null;
}

// Per-judge pass-rate movement from A (prior) to B (candidate): "did the last edit help, and on
// which dimension?". Union of judges present in either artifact so a judge that only ran on one
// side still shows (with a null on the missing side rather than a misleading 0).
export function judgePassRateDiff(
	a: EvalArtifact,
	b: EvalArtifact,
): JudgePassRateDiff[] {
	const ra = new Map(judgePassRates(a).map((r) => [r.judge, r.rate]));
	const rb = new Map(judgePassRates(b).map((r) => [r.judge, r.rate]));
	const present = new Set<string>([...ra.keys(), ...rb.keys()]);
	return orderJudges(present).map((judge) => {
		const av = ra.get(judge) ?? null;
		const bv = rb.get(judge) ?? null;
		return {
			judge,
			a: av,
			b: bv,
			delta: av === null || bv === null ? null : bv - av,
		};
	});
}
