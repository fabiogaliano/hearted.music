import type {
	SongAnalysisLyrical,
	SongAnalysisResult,
} from "@/lib/domains/enrichment/content-analysis/song-analysis";

export type Severity = "low" | "medium" | "high";

export interface RuleHit {
	rule: string;
	field: string;
	span: string;
	severity: Severity;
	note?: string;
}

export type RuleFn = (analysis: SongAnalysisLyrical) => RuleHit[];

export interface FileReport {
	source: string;
	songId?: string;
	skipped?: "instrumental";
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

export function isLyricalShape(
	analysis: SongAnalysisResult,
): analysis is SongAnalysisLyrical {
	return "interpretation" in analysis && "journey" in analysis;
}
