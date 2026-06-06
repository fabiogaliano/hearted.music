// Persisted eval artifact — the unit the scoreboard diffs. evaluate.ts prints results and
// discards them; for variant-vs-variant comparison we need a saved per-variant snapshot.
//
// The shape is deliberately additive and self-describing: every run's candidate-vs-gold
// verdict is stored RAW, and the scoreboard re-derives the song-level outcome from those raw
// runs (collapseOutcome below) rather than trusting a stored verdict. songOutcome is kept on
// disk only as a human-readable convenience. See claudedocs/06-block1-implementation-plan.md WP2.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const EVAL_ARTIFACT_SCHEMA_VERSION = 1;

/** Candidate-vs-gold verdict, candidate's perspective. WIN = candidate beat gold. */
export type RunOutcome = "WIN" | "LOSS" | "TIE";

/** Song-level collapse of repeated runs. indeterminate blocks automatic keep/revert. */
export type SongOutcome = "success" | "fail" | "indeterminate";

export interface EvalRunVerdict {
	runId: string;
	outcome: RunOutcome;
	confidence: "high" | "medium" | "low";
	/** Whether the two swapped pairwise orders agreed (a flip is reconciled to a tie). */
	agreement: boolean;
	candidateWordCount: number;
	tier1: { high: number; medium: number; low: number };
}

export interface EvalSongRecord {
	key: string;
	song: string;
	spotifyTrackId: string;
	goldWordCount: number;
	runs: EvalRunVerdict[];
	/** Convenience mirror of collapseOutcome(runs); the scoreboard recomputes from runs. */
	songOutcome: SongOutcome;
}

export interface EvalArtifact {
	schemaVersion: typeof EVAL_ARTIFACT_SCHEMA_VERSION;
	/** Short variant label, e.g. "v17@t0.3". */
	label: string;
	variant: {
		promptVersion?: string;
		model?: string;
		/** null = provider default temperature was used. */
		temperature: number | null;
	};
	judgeModel: string;
	generatedAt: string;
	songs: EvalSongRecord[];
}

// Majority WIN-or-TIE wins the song. WIN-or-TIE (not WIN alone) is the collapse the marginal
// Wilson proportion assumes. An EVEN split returns indeterminate — it can only happen on legacy
// even-run data; new variants must use an ODD run count, which guarantees a song-level majority
// and preserves the full n=9 (plan WP2 §4). The scoreboard excludes indeterminate songs from
// inference and surfaces them, so a 2-run split can never fake certainty.
export function collapseOutcome(runs: Pick<EvalRunVerdict, "outcome">[]): SongOutcome {
	if (runs.length === 0) return "indeterminate";
	const winOrTie = runs.filter(
		(r) => r.outcome === "WIN" || r.outcome === "TIE",
	).length;
	const loss = runs.length - winOrTie;
	if (winOrTie > loss) return "success";
	if (loss > winOrTie) return "fail";
	return "indeterminate";
}

export function writeEvalArtifact(path: string, artifact: EvalArtifact): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(artifact, null, 2)}\n`);
}

export function readEvalArtifact(path: string): EvalArtifact {
	const parsed = JSON.parse(readFileSync(path, "utf-8")) as EvalArtifact;
	if (parsed.schemaVersion !== EVAL_ARTIFACT_SCHEMA_VERSION) {
		throw new Error(
			`eval artifact ${path} has schemaVersion ${parsed.schemaVersion}, expected ${EVAL_ARTIFACT_SCHEMA_VERSION}`,
		);
	}
	return parsed;
}
