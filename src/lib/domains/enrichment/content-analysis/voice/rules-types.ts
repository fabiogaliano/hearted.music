// Shared types for the tier-1 voice rules engine (tier1-rules.ts) and the post-generation rewrite
// pass (rewrite-pass.ts). These moved into the prod domain when the rewrite pass was wired into the
// production pipeline (song-analysis.ts) — the rules now define a prod quality gate, not just a
// harness audit. The voice-audit harness re-exports RuleHit/Severity from here so it stays a single
// source of truth (scripts/voice-audit/types.ts).

export type Severity = "low" | "medium" | "high";

export interface RuleHit {
	rule: string;
	field: string;
	span: string;
	severity: Severity;
	note?: string;
}
