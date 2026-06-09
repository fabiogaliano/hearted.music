import type { SongRead } from "@/lib/domains/enrichment/content-analysis/read-schema";
import type {
	RuleHit,
	Severity,
} from "@/lib/domains/enrichment/content-analysis/voice/rules-types";

// RuleHit/Severity were promoted into the prod voice module (voice/rules-types.ts) when the rewrite
// pass was wired into the production pipeline. Re-exported here (type-only — erased at compile time,
// no bundle cost) so the harness's existing `from "../types"` importers keep resolving them, with the
// single source of truth living in prod.
export type { RuleHit, Severity };

// Tier-1 rules grade the redesigned read model (Session 5 migration). The audit
// pipeline no longer touches the legacy 8-field shape; old rows re-enrich via v14.
export type RuleFn = (read: SongRead) => RuleHit[];

export interface FileReport {
	source: string;
	songId?: string;
	// "legacy" marks a stored analysis still in the old 8-field shape (not yet
	// re-enriched through v14); "instrumental" marks a non-lyrical analysis. Both are
	// skipped: the new rules only grade SongRead.
	skipped?: "instrumental" | "legacy";
	hits: RuleHit[];
}

export interface LintReport {
	files: FileReport[];
	totals: Record<Severity, number>;
	byRule: Record<string, number>;
}

export interface JudgeFinding {
	judge: string;
	passed: boolean;
	evidence: string[];
	rationale?: string;
}

export interface TokenUsage {
	prompt: number;
	completion: number;
	total: number;
}

export interface JudgeReport {
	source: string;
	songId?: string;
	findings: JudgeFinding[];
	tokens: TokenUsage;
}

export interface TokenBudget {
	inputLimit: number;
	outputLimit: number;
}

export interface AuditReport {
	tier1: LintReport;
	tier2?: {
		files: JudgeReport[];
		totals: TokenUsage;
		budget: TokenBudget;
		exceeded: boolean;
	};
}

// Detects the redesigned read shape. The audit only grades reads; old 8-field rows
// and instrumental analyses fail this guard and are skipped upstream.
export function isSongReadShape(value: unknown): value is SongRead {
	if (!value || typeof value !== "object") return false;
	return "take" in value && "arc" in value && "lens" in value;
}
