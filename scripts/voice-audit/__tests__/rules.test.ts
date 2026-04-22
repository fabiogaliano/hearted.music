import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	SongAnalysisLyricalSchema,
	type SongAnalysisLyrical,
} from "@/lib/domains/enrichment/content-analysis/song-analysis";
import {
	academicRegister,
	antithesis,
	bookReportOpener,
	burstiness,
	copulaAvoidance,
	hedging,
	participialClosure,
	pufferyAdjective,
	ruleOfThree,
	runAllRules,
	selfReference,
} from "../tier1/rules";
import { extractAnalysis } from "../tier1/report";

const FIXTURES = path.join(__dirname, "fixtures");

function loadLyrical(file: string): SongAnalysisLyrical {
	const raw = JSON.parse(readFileSync(path.join(FIXTURES, file), "utf-8"));
	const { analysis } = extractAnalysis(raw);
	if (!analysis) throw new Error(`no analysis in ${file}`);
	return SongAnalysisLyricalSchema.parse(analysis);
}

function base(): SongAnalysisLyrical {
	return loadLyrical("clean.json");
}

function withInterpretation(text: string): SongAnalysisLyrical {
	return { ...base(), interpretation: text };
}

function withHeadline(text: string): SongAnalysisLyrical {
	return { ...base(), headline: text };
}

describe("clean fixture is clean", () => {
	it("produces zero hits across all rules", () => {
		const analysis = base();
		expect(runAllRules(analysis)).toEqual([]);
	});
});

describe("ai-slop fixture hits expected rules", () => {
	const analysis = loadLyrical("ai-slop.json");
	const hits = runAllRules(analysis);
	const byRule = new Set(hits.map((h) => h.rule));

	it("hits at least five distinct rules", () => {
		expect(byRule.size).toBeGreaterThanOrEqual(5);
	});

	it.each([
		"antithesis",
		"copula-avoidance",
		"puffery-adjective",
	])("hits %s", (rule) => {
		expect(byRule).toContain(rule);
	});
});

describe("antithesis", () => {
	it("flags 'isn't X, it's Y' shape", () => {
		const hits = antithesis(
			withInterpretation("This isn't merely a diss track; it's a reclaiming."),
		);
		expect(hits.length).toBeGreaterThan(0);
		expect(hits[0].severity).toBe("high");
	});

	it("flags 'not just X but Y'", () => {
		const hits = antithesis(
			withInterpretation("Not just a song, but a manifesto for the decade."),
		);
		expect(hits.length).toBeGreaterThan(0);
	});

	it("leaves plain sentences alone", () => {
		expect(
			antithesis(withInterpretation("A goodbye said once and never again.")),
		).toEqual([]);
	});
});

describe("copula-avoidance", () => {
	it("flags 'frames', 'positions', 'amplifies'", () => {
		const hits = copulaAvoidance(
			withInterpretation(
				"It frames the conflict. He positions himself. The beat amplifies the tension.",
			),
		);
		expect(hits.map((h) => h.span.toLowerCase())).toEqual(
			expect.arrayContaining(["frames", "positions", "amplifies"]),
		);
	});
});

describe("puffery-adjective", () => {
	it("flags 'blistering'", () => {
		const hits = pufferyAdjective(withHeadline("A blistering declaration."));
		expect(hits).toHaveLength(1);
		expect(hits[0].field).toBe("headline");
	});

	it("is case-insensitive", () => {
		expect(
			pufferyAdjective(withHeadline("VISCERAL and Transcendent.")),
		).toHaveLength(2);
	});
});

describe("participial-closure", () => {
	it("flags comma-participle tail", () => {
		const hits = participialClosure(
			withInterpretation(
				"A quiet kind of heartbreak, revealing the cost of pride.",
			),
		);
		expect(hits.length).toBeGreaterThan(0);
	});

	it("does not flag participles mid-sentence", () => {
		expect(
			participialClosure(
				withInterpretation(
					"Breaking her silence, she walked out of the room forever.",
				),
			),
		).toEqual([]);
	});
});

describe("hedging", () => {
	it("flags 'perhaps' and 'might be'", () => {
		const hits = hedging(
			withInterpretation(
				"Perhaps the refrain is a warning. It might be a confession.",
			),
		);
		expect(hits.length).toBeGreaterThanOrEqual(2);
	});
});

describe("academic-register", () => {
	it("flags 'juxtaposition' and 'explores themes of'", () => {
		const hits = academicRegister(
			withInterpretation(
				"A juxtaposition of tenderness and fury that explores themes of loss.",
			),
		);
		expect(hits.length).toBeGreaterThanOrEqual(2);
		expect(hits.every((h) => h.severity === "high")).toBe(true);
	});
});

describe("self-reference", () => {
	it("flags 'this song' and 'the listener'", () => {
		const hits = selfReference(
			withInterpretation(
				"This song asks the listener to sit with the ache.",
			),
		);
		expect(hits.length).toBeGreaterThanOrEqual(2);
	});
});

describe("book-report-opener", () => {
	it("flags 'This is about' as a field opener", () => {
		const hits = bookReportOpener(
			withInterpretation("This is about losing everything at once."),
		);
		expect(hits).toHaveLength(1);
	});

	it("does not flag mid-field occurrences", () => {
		expect(
			bookReportOpener(
				withInterpretation(
					"Standing in the rain, she realizes this is about more than the call.",
				),
			),
		).toEqual([]);
	});
});

describe("burstiness", () => {
	it("flags flat-rhythm prose", () => {
		const flat =
			"Word word word word word. Word word word word word. Word word word word word.";
		const hits = burstiness({ ...base(), interpretation: flat });
		expect(hits.map((h) => h.field)).toContain("interpretation");
	});

	it("leaves varied rhythm alone", () => {
		const hits = burstiness(base());
		const interpHits = hits.filter((h) => h.field === "interpretation");
		expect(interpHits).toEqual([]);
	});
});

describe("rule-of-three", () => {
	it("flags three-item parallel lists", () => {
		const hits = ruleOfThree(
			withInterpretation("Sharp, funny, and devastating all at once."),
		);
		expect(hits.length).toBeGreaterThan(0);
	});
});
