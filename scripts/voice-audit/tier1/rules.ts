import type { SongAnalysisLyrical } from "@/lib/domains/enrichment/content-analysis/song-analysis";
import type { RuleHit, Severity } from "../types";
import { sentenceLengthCV, splitSentences } from "./burstiness";

export const BURSTINESS_CV_THRESHOLD = 0.25;

interface StringField {
	name: string;
	value: string;
}

function collectStringFields(a: SongAnalysisLyrical): StringField[] {
	const out: StringField[] = [
		{ name: "headline", value: a.headline },
		{ name: "compound_mood", value: a.compound_mood },
		{ name: "mood_description", value: a.mood_description },
		{ name: "interpretation", value: a.interpretation },
		{ name: "sonic_texture", value: a.sonic_texture },
	];
	a.themes.forEach((t, i) => {
		out.push({ name: `themes[${i}].name`, value: t.name });
		out.push({ name: `themes[${i}].description`, value: t.description });
	});
	a.journey.forEach((j, i) => {
		out.push({ name: `journey[${i}].section`, value: j.section });
		out.push({ name: `journey[${i}].mood`, value: j.mood });
		out.push({ name: `journey[${i}].description`, value: j.description });
	});
	a.key_lines.forEach((k, i) => {
		out.push({ name: `key_lines[${i}].insight`, value: k.insight });
	});
	return out;
}

function prose(a: SongAnalysisLyrical): StringField[] {
	return collectStringFields(a).filter(
		(f) =>
			f.name !== "compound_mood" &&
			!f.name.endsWith(".section") &&
			!f.name.endsWith(".mood") &&
			!f.name.endsWith(".name"),
	);
}

function matchRegexHits(
	fields: StringField[],
	rule: string,
	severity: Severity,
	pattern: RegExp,
): RuleHit[] {
	const hits: RuleHit[] = [];
	for (const f of fields) {
		const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
		let m: RegExpExecArray | null;
		while ((m = re.exec(f.value)) !== null) {
			hits.push({
				rule,
				field: f.name,
				span: m[0].trim(),
				severity,
			});
			if (m.index === re.lastIndex) re.lastIndex++;
		}
	}
	return hits;
}

function matchWordList(
	fields: StringField[],
	rule: string,
	severity: Severity,
	words: string[],
): RuleHit[] {
	const hits: RuleHit[] = [];
	const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
	const re = new RegExp(`\\b(${escaped.join("|")})\\b`, "gi");
	for (const f of fields) {
		const copy = new RegExp(re.source, re.flags);
		let m: RegExpExecArray | null;
		while ((m = copy.exec(f.value)) !== null) {
			hits.push({
				rule,
				field: f.name,
				span: m[0],
				severity,
			});
		}
	}
	return hits;
}

export const antithesis = (a: SongAnalysisLyrical): RuleHit[] =>
	matchRegexHits(
		prose(a),
		"antithesis",
		"high",
		/(it'?s not |isn'?t |is not |not just |doesn'?t just |more than just |far from being |not merely |not simply )[^.]*?(,|;|—| but | it'?s | it is )/gi,
	);

const COPULA_AVOIDANCE_TERMS = [
	"serves as",
	"stands as",
	"acts as",
	"marks",
	"represents",
	"embodies",
	"amplifies",
	"frames",
	"cements",
	"positions",
	"underscores",
	"highlights the",
];

export const copulaAvoidance = (a: SongAnalysisLyrical): RuleHit[] =>
	matchWordList(prose(a), "copula-avoidance", "medium", COPULA_AVOIDANCE_TERMS);

const PUFFERY_ADJECTIVES = [
	"blistering",
	"unstoppable",
	"relentless",
	"definitive",
	"vibrant",
	"profound",
	"renowned",
	"groundbreaking",
	"captivating",
	"transcendent",
	"breathtaking",
	"visceral",
	"haunting",
	"shimmering",
];

export const pufferyAdjective = (a: SongAnalysisLyrical): RuleHit[] =>
	matchWordList(prose(a), "puffery-adjective", "medium", PUFFERY_ADJECTIVES);

export const participialClosure = (a: SongAnalysisLyrical): RuleHit[] =>
	matchRegexHits(
		prose(a),
		"participial-closure",
		"high",
		/[,;]\s+\w+ing\s+[^.!?]+\./gm,
	);

const HEDGING_TERMS = [
	"perhaps",
	"might be",
	"seems to",
	"could be interpreted as",
	"it'?s worth noting",
	"it is important to note",
];

export const hedging = (a: SongAnalysisLyrical): RuleHit[] =>
	matchRegexHits(
		prose(a),
		"hedging",
		"medium",
		new RegExp(`\\b(${HEDGING_TERMS.join("|")})\\b`, "gi"),
	);

const ACADEMIC_TERMS = [
	"disorientation",
	"juxtaposition",
	"dichotomy",
	"catharsis",
	"existential",
	"commentary on",
	"explores themes of",
	"delves into",
];

export const academicRegister = (a: SongAnalysisLyrical): RuleHit[] =>
	matchWordList(prose(a), "academic-register", "high", ACADEMIC_TERMS);

const SELF_REFERENCE_TERMS = [
	"this song",
	"the track",
	"the listener",
	"the speaker",
	"the narrator",
	"the singer",
	"the vocalist",
];

export const selfReference = (a: SongAnalysisLyrical): RuleHit[] =>
	matchRegexHits(
		prose(a),
		"self-reference",
		"high",
		new RegExp(`\\b(${SELF_REFERENCE_TERMS.join("|")})\\b`, "gi"),
	);

const BOOK_REPORT_OPENERS = [
	"This is about",
	"This is an anthem",
	"This is a",
	"This isn't",
	"It's not just",
	"More than a",
];

export const bookReportOpener = (a: SongAnalysisLyrical): RuleHit[] => {
	const hits: RuleHit[] = [];
	for (const f of prose(a)) {
		const trimmed = f.value.trimStart();
		for (const opener of BOOK_REPORT_OPENERS) {
			if (trimmed.toLowerCase().startsWith(opener.toLowerCase())) {
				hits.push({
					rule: "book-report-opener",
					field: f.name,
					span: trimmed.slice(0, opener.length + 20),
					severity: "high",
				});
				break;
			}
		}
	}
	return hits;
};

export const burstiness = (a: SongAnalysisLyrical): RuleHit[] => {
	const hits: RuleHit[] = [];
	const longFields: StringField[] = [
		{ name: "mood_description", value: a.mood_description },
		{ name: "interpretation", value: a.interpretation },
		{ name: "sonic_texture", value: a.sonic_texture },
		...a.journey.map((j, i) => ({
			name: `journey[${i}].description`,
			value: j.description,
		})),
	];
	for (const f of longFields) {
		const sentences = splitSentences(f.value);
		if (sentences.length < 3) continue;
		const cv = sentenceLengthCV(f.value);
		if (cv !== null && cv < BURSTINESS_CV_THRESHOLD) {
			hits.push({
				rule: "burstiness",
				field: f.name,
				span: sentences[0].slice(0, 80),
				severity: "low",
				note: `CV=${cv.toFixed(3)} (threshold ${BURSTINESS_CV_THRESHOLD})`,
			});
		}
	}
	return hits;
};

export const ruleOfThree = (a: SongAnalysisLyrical): RuleHit[] =>
	matchRegexHits(
		prose(a),
		"rule-of-three",
		"low",
		/(\b[\w'-]+\b,\s+\b[\w'-]+\b,\s+and\s+\b[\w'-]+\b)/gi,
	);

export const ALL_RULES = [
	antithesis,
	copulaAvoidance,
	pufferyAdjective,
	participialClosure,
	hedging,
	academicRegister,
	selfReference,
	bookReportOpener,
	burstiness,
	ruleOfThree,
] as const;

export function runAllRules(analysis: SongAnalysisLyrical): RuleHit[] {
	return ALL_RULES.flatMap((r) => r(analysis));
}
