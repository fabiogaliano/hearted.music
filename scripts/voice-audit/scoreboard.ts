#!/usr/bin/env bun
/// <reference types="bun" />

// Compares eval artifacts at the SONG level — the only honest unit of generalization at n=9.
// Multiple runs of one song are repeated measures, NOT extra n: they collapse to one song-level
// outcome (eval-artifact.collapseOutcome) before any inference runs. The scoreboard reports, per
// variant, its marginal WIN-or-TIE rate with a Wilson band; and for a paired A-vs-B comparison,
// the discordant song counts fed to a McNemar mid-p test. See claudedocs/06-block1-implementation-plan.md WP2.
//
//   bun scripts/voice-audit/scoreboard.ts eval-artifacts/v17-base.json
//   bun scripts/voice-audit/scoreboard.ts eval-artifacts/v17-base.json eval-artifacts/v18-cand.json

import {
	collapseOutcome,
	readEvalArtifact,
	type EvalArtifact,
	type EvalSongRecord,
	type SongOutcome,
} from "./eval-artifact";
import { mcnemarMidP, wilsonInterval } from "./stats";
import {
	hasPointwise,
	judgePassRateDiff,
	judgePassRates,
	pointwiseCoverage,
	qualitativeDigest,
} from "./tier2-aggregate";

const N9_NOTE = [
	"n=9 NOTE: 9 gold songs is the unit of generalization. Wilson bands are wide and",
	"McNemar only fires on large same-direction flips. Treat significance as a NOISE VETO,",
	'not a keep gate — absence of significance means "too noisy to trust", never "edit',
	'proven bad". A 1-song change is descriptive, not persuasive.',
].join("\n");

// The scoreboard always re-derives the song outcome from raw runs rather than trusting the
// stored songOutcome, so a hand-edited artifact can never smuggle a fake majority past it.
function outcomeOf(song: EvalSongRecord): SongOutcome {
	return collapseOutcome(song.runs);
}

function meanCandidateWordCount(song: EvalSongRecord): number {
	if (song.runs.length === 0) return 0;
	return song.runs.reduce((a, r) => a + r.candidateWordCount, 0) / song.runs.length;
}

export interface MarginalSummary {
	successes: number;
	determinate: number;
	indeterminate: number;
	total: number;
	rate: number | null;
	wilson: { lo: number; hi: number };
}

// Marginal WIN-or-TIE success rate for one variant. Indeterminate songs are excluded from the
// proportion (they carry no decision) but counted and surfaced — they must never be silently
// rounded into either bucket.
export function marginalSummary(artifact: EvalArtifact): MarginalSummary {
	let successes = 0;
	let determinate = 0;
	let indeterminate = 0;
	for (const song of artifact.songs) {
		const o = outcomeOf(song);
		if (o === "indeterminate") {
			indeterminate++;
			continue;
		}
		determinate++;
		if (o === "success") successes++;
	}
	return {
		successes,
		determinate,
		indeterminate,
		total: artifact.songs.length,
		rate: determinate ? successes / determinate : null,
		wilson: wilsonInterval(successes, determinate),
	};
}

export interface PairedDiscordance {
	/** Songs where A succeeds and B fails. */
	b: number;
	/** Songs where A fails and B succeeds. */
	c: number;
	bothSuccess: number;
	bothFail: number;
	/** Songs present + determinate in both variants. */
	paired: number;
	/** Songs present in both but indeterminate in at least one (excluded from the test). */
	excluded: number;
	perSong: Array<{ key: string; a: SongOutcome; b: SongOutcome }>;
}

// Paired discordance across the songs both variants cover and both call determinately. b and c
// are the McNemar discordant cells; concordant songs (both succeed / both fail) carry no paired
// signal. This is a PAIRED A-vs-B measure — never computed from one variant's internal win/loss
// mix vs gold, which would be meaningless.
export function pairedDiscordance(
	a: EvalArtifact,
	bArtifact: EvalArtifact,
): PairedDiscordance {
	const byKeyB = new Map(bArtifact.songs.map((s) => [s.key, s]));
	let b = 0;
	let c = 0;
	let bothSuccess = 0;
	let bothFail = 0;
	let excluded = 0;
	const perSong: PairedDiscordance["perSong"] = [];
	for (const songA of a.songs) {
		const songB = byKeyB.get(songA.key);
		if (!songB) continue;
		const oa = outcomeOf(songA);
		const ob = outcomeOf(songB);
		perSong.push({ key: songA.key, a: oa, b: ob });
		if (oa === "indeterminate" || ob === "indeterminate") {
			excluded++;
			continue;
		}
		if (oa === "success" && ob === "success") bothSuccess++;
		else if (oa === "fail" && ob === "fail") bothFail++;
		else if (oa === "success" && ob === "fail") b++;
		else c++;
	}
	return {
		b,
		c,
		bothSuccess,
		bothFail,
		paired: bothSuccess + bothFail + b + c,
		excluded,
		perSong,
	};
}

export interface LengthEffect {
	perSong: Array<{ key: string; delta: number; outcome: SongOutcome }>;
	meanDeltaSuccess: number | null;
	meanDeltaFail: number | null;
	/** Pearson r between length-delta and success(1)/fail(0); null when undefined. */
	correlation: number | null;
}

// Per-song candidate−gold word-count delta, plus a lightweight check for verdict tracking
// length. Pearson r over determinate songs only; null when there is no variance in outcome or
// delta (e.g. all songs the same outcome). This is the cheap LC tell, NOT a length-controlled
// regression — that is deliberately out of scope for Block 1.
export function lengthEffect(artifact: EvalArtifact): LengthEffect {
	const perSong = artifact.songs.map((s) => ({
		key: s.key,
		delta: meanCandidateWordCount(s) - s.goldWordCount,
		outcome: outcomeOf(s),
	}));
	const determinate = perSong.filter((p) => p.outcome !== "indeterminate");
	const succ = determinate.filter((p) => p.outcome === "success");
	const fail = determinate.filter((p) => p.outcome === "fail");
	const mean = (xs: number[]) =>
		xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
	return {
		perSong,
		meanDeltaSuccess: mean(succ.map((p) => p.delta)),
		meanDeltaFail: mean(fail.map((p) => p.delta)),
		correlation: pearson(
			determinate.map((p) => p.delta),
			determinate.map((p) => (p.outcome === "success" ? 1 : 0)),
		),
	};
}

function pearson(xs: number[], ys: number[]): number | null {
	const n = xs.length;
	if (n < 2) return null;
	const mx = xs.reduce((a, b) => a + b, 0) / n;
	const my = ys.reduce((a, b) => a + b, 0) / n;
	let sxy = 0;
	let sxx = 0;
	let syy = 0;
	for (let i = 0; i < n; i++) {
		const dx = xs[i] - mx;
		const dy = ys[i] - my;
		sxy += dx * dy;
		sxx += dx * dx;
		syy += dy * dy;
	}
	if (sxx === 0 || syy === 0) return null;
	return sxy / Math.sqrt(sxx * syy);
}

const OUTCOME_GLYPH: Record<SongOutcome, string> = {
	success: "success",
	fail: "fail   ",
	indeterminate: "INDET  ",
};

function fmtDelta(d: number): string {
	const r = Math.round(d);
	return r >= 0 ? `+${r}` : String(r);
}

function renderMarginal(artifact: EvalArtifact): string {
	const m = marginalSummary(artifact);
	const len = lengthEffect(artifact);
	const runsPerSong = artifact.songs[0]?.runs.length ?? 0;
	const lines: string[] = [];
	lines.push(
		`VARIANT: ${artifact.label}  (model ${artifact.variant.model ?? "?"}, ${runsPerSong} run(s)/song, judge ${artifact.judgeModel})`,
	);
	lines.push(
		`  win-or-tie: ${m.successes}/${m.determinate} determinate = ${m.rate === null ? "n/a" : m.rate.toFixed(2)}  Wilson95 [${m.wilson.lo.toFixed(2)}, ${m.wilson.hi.toFixed(2)}]`,
	);
	if (m.indeterminate) {
		lines.push(`  indeterminate (excluded, blocks auto keep/revert): ${m.indeterminate}`);
	}
	lines.push("  per-song:");
	const deltaByKey = new Map(len.perSong.map((p) => [p.key, p.delta]));
	for (const song of artifact.songs) {
		const o = outcomeOf(song);
		const runStr = song.runs.map((r) => r.outcome).join(",");
		lines.push(
			`    ${song.key.padEnd(18)} ${OUTCOME_GLYPH[o]}  (${runStr})  len Δ ${fmtDelta(deltaByKey.get(song.key) ?? 0)}`,
		);
	}
	const ms = len.meanDeltaSuccess;
	const mf = len.meanDeltaFail;
	let lengthLine = `  length: mean Δ success ${ms === null ? "n/a" : fmtDelta(ms)}, fail ${mf === null ? "n/a" : fmtDelta(mf)}`;
	if (len.correlation !== null) {
		lengthLine += `  (r=${len.correlation.toFixed(2)})`;
		if (Math.abs(len.correlation) >= 0.5) {
			lengthLine += "  ⚠ verdict may track length — inspect before trusting";
		}
	}
	lines.push(lengthLine);
	return lines.join("\n");
}

function renderPaired(a: EvalArtifact, b: EvalArtifact): string {
	const d = pairedDiscordance(a, b);
	const test = mcnemarMidP(d.b, d.c);
	const lines: string[] = [];
	lines.push(`PAIRED ${a.label}  vs  ${b.label}  (McNemar mid-p over songs determinate in both)`);
	lines.push(`  both success: ${d.bothSuccess}   both fail: ${d.bothFail}`);
	lines.push(
		`  A>B (A success, B fail): b=${d.b}   B>A (A fail, B success): c=${d.c}   paired n=${d.paired}`,
	);
	if (d.excluded) {
		lines.push(`  excluded (indeterminate in at least one variant): ${d.excluded}`);
	}
	const sig = test.p < 0.05;
	lines.push(
		`  McNemar mid-p = ${test.p.toFixed(3)}  → ${sig ? "SIGNIFICANT (strong positive)" : 'not significant at n=9 (too noisy to trust, not a verdict)'}`,
	);
	lines.push("  per-song  A | B:");
	for (const p of d.perSong) {
		lines.push(`    ${p.key.padEnd(18)} ${OUTCOME_GLYPH[p.a]} | ${OUTCOME_GLYPH[p.b]}`);
	}
	return lines.join("\n");
}

function fmtRate(rate: number | null, passed: number, total: number): string {
	return rate === null ? "n/a" : `${(rate * 100).toFixed(0)}% (${passed}/${total})`;
}

// Per-judge pass-rate — the "which dimension keeps failing" diagnostic. Descriptive counts over
// candidates, deliberately bandless: the inferential unit at n=9 is the song-level rate above, so a
// CI here would falsely treat repeated runs as independent n. Grounding is listed first (priority-1).
function renderJudgePassRates(artifact: EvalArtifact): string {
	const rates = judgePassRates(artifact);
	const cov = pointwiseCoverage(artifact);
	const coverageLabel = cov.complete
		? `over ${cov.total} candidates`
		: `over ${cov.withTier2} of ${cov.total} candidates with tier-2 data`;
	const lines: string[] = [
		`TIER-2 PASS-RATES — ${artifact.label}  (descriptive, ${coverageLabel}; not inferential)`,
	];
	if (!cov.complete) {
		lines.push(
			`  ⚠ PARTIAL coverage: ${cov.total - cov.withTier2} of ${cov.total} candidate(s) lack tier-2 data — rates below cover only the ${cov.withTier2} pointwise-judged run(s)`,
		);
	}
	for (const r of rates) {
		const flag = r.judge === "grounding" ? "  ← priority-1" : "";
		lines.push(`  ${r.judge.padEnd(22)} ${fmtRate(r.rate, r.passed, r.total)}${flag}`);
	}
	return lines.join("\n");
}

// The qualitative "what keeps losing" digest the orchestrator reads to form its next hypothesis:
// the recurring judge evidence (grouped by judge, worst first) and the pairwise rationales from runs
// that did not beat gold. Raw aggregation, not semantic clustering — the recurring phrasing is the
// signal.
function renderQualitative(artifact: EvalArtifact): string {
	const digest = qualitativeDigest(artifact);
	const lines: string[] = [`WHAT KEEPS LOSING — ${artifact.label}`];
	if (digest.byJudge.length === 0) {
		lines.push("  no tier-2 failures across candidates");
	} else {
		lines.push("  judge failures (most frequent first):");
		for (const j of digest.byJudge) {
			lines.push(`    ${j.judge} ×${j.failures}`);
			for (const e of j.evidence) lines.push(`      · ${e}`);
		}
	}
	if (digest.losingRationales.length) {
		lines.push(
			`  non-winning pairwise rationales (${digest.losingRationales.length} shown; ${digest.totalNonWinning} non-winning run(s), two swapped-order rationales each):`,
		);
		for (const r of digest.losingRationales) {
			lines.push(`    [${r.outcome}] ${r.key}: ${r.rationale}`);
		}
	} else {
		lines.push(`  non-winning runs: ${digest.totalNonWinning}`);
	}
	return lines.join("\n");
}

function fmtDeltaPct(d: number | null): string {
	if (d === null) return "n/a";
	const pts = Math.round(d * 100);
	return pts >= 0 ? `+${pts}pt` : `${pts}pt`;
}

// Per-judge pass-rate movement A→B: "did the last edit help, and on which dimension?". The paired
// McNemar above answers it for the optimization target (pairwise vs gold); this localizes the shift
// to specific judges so the loop can read whether a grounding/specificity edit actually landed.
function renderJudgeDiff(a: EvalArtifact, b: EvalArtifact): string {
	const diffs = judgePassRateDiff(a, b);
	const lines: string[] = [
		`TIER-2 PASS-RATE DIFF  ${a.label} → ${b.label}  (Δ = B − A, in percentage points)`,
	];
	for (const d of diffs) {
		const aStr = d.a === null ? "n/a" : `${(d.a * 100).toFixed(0)}%`;
		const bStr = d.b === null ? "n/a" : `${(d.b * 100).toFixed(0)}%`;
		lines.push(`  ${d.judge.padEnd(22)} ${aStr.padStart(4)} → ${bStr.padStart(4)}  ${fmtDeltaPct(d.delta)}`);
	}
	return lines.join("\n");
}

function main() {
	const paths = process.argv.slice(2).filter((a) => !a.startsWith("--"));
	if (paths.length < 1 || paths.length > 2) {
		console.error(
			"usage: bun scripts/voice-audit/scoreboard.ts <artifactA.json> [artifactB.json]",
		);
		process.exit(1);
	}

	const a = readEvalArtifact(paths[0]);
	const b = paths[1] ? readEvalArtifact(paths[1]) : null;

	console.log(`\n${"=".repeat(72)}`);
	console.log(`SCOREBOARD${b ? " — paired comparison" : ""}`);
	console.log("=".repeat(72));
	console.log(`${N9_NOTE}\n`);

	console.log(renderMarginal(a));
	if (hasPointwise(a)) {
		console.log(`\n${renderJudgePassRates(a)}`);
		console.log(`\n${renderQualitative(a)}`);
	}
	if (b) {
		console.log(`\n${renderMarginal(b)}`);
		if (hasPointwise(b)) {
			console.log(`\n${renderJudgePassRates(b)}`);
			console.log(`\n${renderQualitative(b)}`);
		}
		console.log(`\n${"-".repeat(72)}`);
		console.log(renderPaired(a, b));
		if (hasPointwise(a) && hasPointwise(b)) {
			console.log(`\n${renderJudgeDiff(a, b)}`);
		}
	}
	if (!hasPointwise(a) && !(b && hasPointwise(b))) {
		console.log(
			"\n(no tier-2 pointwise data in these artifacts — re-run evaluate.ts with --pointwise for per-judge pass-rates and the 'what keeps losing' digest)",
		);
	}
	console.log("");
	process.exit(0);
}

if (import.meta.main) main();
