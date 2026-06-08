import type { SongRead } from "@/lib/domains/enrichment/content-analysis/read-schema";

export type Severity = "low" | "medium" | "high";

export interface RuleHit {
	rule: string;
	field: string;
	span: string;
	severity: Severity;
	note?: string;
}

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
