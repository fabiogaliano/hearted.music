import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	ConceptReadSchema,
	type ConceptRead,
} from "@/lib/domains/enrichment/content-analysis/concept-schema";
import {
	academicRegister,
	aiVocabulary,
	antithesis,
	bookReportOpener,
	burstiness,
	copulaAvoidance,
	dashes,
	hedging,
	lexicalRepetition,
	participialClosure,
	pufferyAdjective,
	ruleOfThree,
	runAllRules,
	selfReference,
} from "../tier1/rules";

const FIXTURES = path.join(__dirname, "fixtures");

function loadRead(file: string): ConceptRead {
	const raw = JSON.parse(readFileSync(path.join(FIXTURES, file), "utf-8"));
	return ConceptReadSchema.parse(raw);
}

function base(): ConceptRead {
	return loadRead("clean.json");
}

// The rules read free-text fields; `take` is the longest prose field (was
// `interpretation`) and `image` is the short felt-image (was `headline`).
function withTake(text: string): ConceptRead {
	return { ...base(), take: text };
}

function withImage(text: string): ConceptRead {
	return { ...base(), image: text };
}

describe("clean fixture is clean", () => {
	it("produces zero hits across all rules", () => {
		const analysis = base();
		expect(runAllRules(analysis)).toEqual([]);
	});
});

describe("null texture (audio features absent)", () => {
	it("audits the remaining fields without crashing and never flags texture", () => {
		const analysis: ConceptRead = { ...base(), texture: null };
		expect(runAllRules(analysis)).toEqual([]);
		expect(burstiness(analysis).some((h) => h.field === "texture")).toBe(
			false,
		);
	});
});

describe("ai-slop fixture hits expected rules", () => {
	const analysis = loadRead("ai-slop.json");
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
			withTake("This isn't merely a diss track; it's a reclaiming."),
		);
		expect(hits.length).toBeGreaterThan(0);
		expect(hits[0].severity).toBe("high");
	});

	it("flags 'not just X but Y'", () => {
		const hits = antithesis(
			withTake("Not just a song, but a manifesto for the decade."),
		);
		expect(hits.length).toBeGreaterThan(0);
	});

	it("flags 'not only X but Y'", () => {
		const hits = antithesis(
			withTake("Not only a diss track, but a coronation of the coast."),
		);
		expect(hits.length).toBeGreaterThan(0);
	});

	it("flags the 'no X, no Y, just Z' negation", () => {
		const hits = antithesis(
			withTake("No apology, no retreat, just a wall of sound."),
		);
		expect(hits.length).toBeGreaterThan(0);
	});

	it("leaves plain sentences alone", () => {
		expect(
			antithesis(withTake("A goodbye said once and never again.")),
		).toEqual([]);
	});
});

describe("copula-avoidance", () => {
	it("flags 'frames', 'positions', 'amplifies'", () => {
		const hits = copulaAvoidance(
			withTake(
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
		const hits = pufferyAdjective(withImage("A blistering declaration."));
		expect(hits).toHaveLength(1);
		expect(hits[0].field).toBe("image");
	});

	it("is case-insensitive", () => {
		expect(
			pufferyAdjective(withImage("VISCERAL and Transcendent.")),
		).toHaveLength(2);
	});
});

describe("ai-vocabulary", () => {
	it("flags a cluster of two or more AI-vocabulary words", () => {
		const hits = aiVocabulary(
			withTake("An intricate tapestry of pivotal moments."),
		);
		const words = new Set(hits.map((h) => h.span.toLowerCase()));
		expect(words.size).toBeGreaterThanOrEqual(2);
		expect(hits.every((h) => h.severity === "medium")).toBe(true);
	});

	it("ignores a single isolated AI-vocabulary word", () => {
		expect(
			aiVocabulary(withTake("The song is a quiet tapestry of grief.")),
		).toEqual([]);
	});
});

describe("participial-closure", () => {
	it("flags comma-participle tail", () => {
		const hits = participialClosure(
			withTake(
				"A quiet kind of heartbreak, revealing the cost of pride.",
			),
		);
		expect(hits.length).toBeGreaterThan(0);
	});

	it("does not flag participles mid-sentence", () => {
		expect(
			participialClosure(
				withTake(
					"Breaking her silence, she walked out of the room forever.",
				),
			),
		).toEqual([]);
	});

	it("does not flag a short attributive -ing adjective", () => {
		expect(
			participialClosure(
				withTake("A low, knocking drum. Pure menace."),
			),
		).toEqual([]);
	});

	it("does not flag an -ing adjective on a clause subject", () => {
		expect(
			participialClosure(
				withTake(
					"A chilling whisper opens, thumping bass drives the rhythm forward.",
				),
			),
		).toEqual([]);
	});

	it("still flags a genuine tacked-on participial after a noun object", () => {
		const hits = participialClosure(
			withTake("She holds the room, exposing every weakness at once."),
		);
		expect(hits.length).toBeGreaterThan(0);
	});

	it("does not flag an -ing adjective whose subject takes 'provides' or 'add'", () => {
		expect(
			participialClosure(
				withTake("A bouncy groove takes over, driving drum beat provides a persistent pulse."),
			),
		).toEqual([]);
		expect(
			participialClosure(
				withTake("The beat hits first, swirling synths add a dreamy layer."),
			),
		).toEqual([]);
	});
});

describe("hedging", () => {
	it("flags 'perhaps' and 'might be'", () => {
		const hits = hedging(
			withTake(
				"Perhaps the refrain is a warning. It might be a confession.",
			),
		);
		expect(hits.length).toBeGreaterThanOrEqual(2);
	});
});

describe("academic-register", () => {
	it("flags 'juxtaposition' and 'explores themes of'", () => {
		const hits = academicRegister(
			withTake(
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
			withTake(
				"This song asks the listener to sit with the ache.",
			),
		);
		expect(hits.length).toBeGreaterThanOrEqual(2);
	});
});

describe("book-report-opener", () => {
	it("flags 'This is about' as a field opener", () => {
		const hits = bookReportOpener(
			withTake("This is about losing everything at once."),
		);
		expect(hits).toHaveLength(1);
	});

	it("does not flag mid-field occurrences", () => {
		expect(
			bookReportOpener(
				withTake(
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
		const hits = burstiness({ ...base(), take: flat });
		expect(hits.map((h) => h.field)).toContain("take");
	});

	it("leaves varied rhythm alone", () => {
		const hits = burstiness(base());
		const takeHits = hits.filter((h) => h.field === "take");
		expect(takeHits).toEqual([]);
	});
});

describe("rule-of-three", () => {
	it("flags three-item parallel lists", () => {
		const hits = ruleOfThree(
			withTake("Sharp, funny, and devastating all at once."),
		);
		expect(hits.length).toBeGreaterThan(0);
	});

	it("flags phrasal triplets, not just single words", () => {
		const hits = ruleOfThree(
			withTake("A cry for help, a fist raised, and a quiet goodbye."),
		);
		expect(hits.length).toBeGreaterThan(0);
	});
});

describe("lexical-repetition", () => {
	it("flags a content word repeated three or more times", () => {
		const hits = lexicalRepetition(
			withTake(
				"The community moves as a community, a community against the world.",
			),
		);
		expect(hits).toHaveLength(1);
		expect(hits[0].span).toBe("community");
		expect(hits[0].severity).toBe("low");
		expect(hits[0].note).toContain("3");
	});

	it("leaves a content word repeated only twice alone", () => {
		expect(
			lexicalRepetition(
				withTake("The thunder answers the thunder, then fades."),
			),
		).toEqual([]);
	});

	it("ignores repeated function words", () => {
		expect(
			lexicalRepetition(
				withTake("It is what it is, and that is that, so it goes."),
			),
		).toEqual([]);
	});
});

describe("dash", () => {
	it("flags an em dash as medium", () => {
		const hits = dashes(withTake("She left — and the room went quiet."));
		expect(hits).toHaveLength(1);
		expect(hits[0].severity).toBe("medium");
	});

	it("flags an en dash as medium", () => {
		const hits = dashes(withTake("A slow burn – then nothing."));
		expect(hits).toHaveLength(1);
		expect(hits[0].severity).toBe("medium");
	});

	it("flags an intra-word hyphen as low and reports the whole compound", () => {
		const hits = dashes(withTake("A late-night confession."));
		expect(hits).toHaveLength(1);
		expect(hits[0].severity).toBe("low");
		expect(hits[0].span).toBe("late-night");
	});

	it("flags a spaced hyphen used as a dash, as medium", () => {
		const hits = dashes(withTake("Quiet at first - then it erupts."));
		expect(hits).toHaveLength(1);
		expect(hits[0].severity).toBe("medium");
	});

	it("does not flag a hyphen inside a quoted lyric line", () => {
		const analysis = {
			...base(),
			lines: [{ line: "we're tip-toeing out the door" }],
		};
		expect(dashes(analysis)).toEqual([]);
	});

	it("leaves dash-free prose alone", () => {
		expect(dashes(withTake("A clean goodbye said once."))).toEqual([]);
	});
});
