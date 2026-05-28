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

const ANTITHESIS_FRAME =
	/(it'?s not |isn'?t |is not |not just |not only |doesn'?t just |more than just |far from being |not merely |not simply )[^.]*?(,|;|—| but | it'?s | it is )/gi;

// huntingthemuse "no X, no Y, just Z" — staccato negation that manufactures emphasis.
const ANTITHESIS_NEGATION_LIST = /\bno\s+[\w'-]+,\s+no\s+[\w'-]+,\s+(?:just|only)\b/gi;

export const antithesis = (a: SongAnalysisLyrical): RuleHit[] => [
	...matchRegexHits(prose(a), "antithesis", "high", ANTITHESIS_FRAME),
	...matchRegexHits(prose(a), "antithesis", "high", ANTITHESIS_NEGATION_LIST),
];

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

// The Wikipedia "Signs of AI writing" cluster. Kept disjoint from the puffery /
// copula / academic lists so a word is attributable to exactly one rule.
const AI_VOCABULARY = [
	"tapestry",
	"intricate",
	"intricacies",
	"testament",
	"leverage",
	"leverages",
	"leveraging",
	"foster",
	"fosters",
	"fostering",
	"showcase",
	"showcases",
	"showcasing",
	"boast",
	"boasts",
	"bolster",
	"bolsters",
	"bolstered",
	"interplay",
	"pivotal",
	"crucial",
	"nestled",
	"realm",
	"myriad",
	"multifaceted",
	"nuanced",
	"enduring",
	"emblematic",
];

// It is the co-occurrence of these words, not any single one, that signals AI
// (per the Wikipedia page), so we only flag when two or more distinct ones appear.
export const aiVocabulary = (a: SongAnalysisLyrical): RuleHit[] => {
	const hits = matchWordList(prose(a), "ai-vocabulary", "medium", AI_VOCABULARY);
	const distinct = new Set(hits.map((h) => h.span.toLowerCase()));
	return distinct.size >= 2 ? hits : [];
};

// Words that, immediately after the -ing token, mark it as a VERB taking a complement
// — i.e. a genuine tacked-on participial clause ("rallying a collective", "hinting at danger").
const PARTICIPIAL_VERBAL_HEADWORDS = new Set([
	"a", "an", "the", "this", "that", "these", "those", "its", "his", "her",
	"their", "your", "my", "our", "it", "them", "everyone", "anyone",
	"everything", "nothing", "no", "all", "into", "to", "of", "at", "with",
	"for", "on", "against", "through", "over", "as", "away", "down", "up",
	"out", "in", "upon", "toward", "towards", "like",
]);

// Present-tense finite verbs that, following a bare noun, reveal the comma clause is
// actually a main clause whose subject carries an -ing ADJECTIVE ("thumping bassline drives ...").
const PARTICIPIAL_FINITE_VERBS = new Set([
	"drives", "gives", "pulls", "sets", "makes", "takes", "builds", "creates",
	"turns", "brings", "leaves", "hangs", "swells", "kicks", "cuts", "pushes",
	"carries", "fills", "floats", "echoes", "becomes", "feels", "sounds",
	"moves", "runs", "hits", "lands", "breaks", "holds", "keeps", "begins",
	"emerges", "appears", "rises", "falls", "grows", "fades", "shifts",
	"returns", "follows", "continues", "signals", "confirms", "opens",
	"closes", "drops", "explodes", "sits", "comes", "goes", "stays",
	"remains", "plays", "anchors", "underpins", "propels", "powers",
	"pulses", "throbs", "thumps", "pounds", "provides", "provide",
	"adds", "add",
]);

// Flags an -ing clause tacked onto a sentence end ("..., revealing the cost of pride.").
// Skips two look-alikes that aren't the tell: a short attributive tail ("..., knocking drums.")
// and a subject modified by an -ing adjective ("..., thumping bassline drives the rhythm.").
export const participialClosure = (a: SongAnalysisLyrical): RuleHit[] => {
	const hits: RuleHit[] = [];
	const re = /[,;]\s+([A-Za-z][A-Za-z']*ing)\s+([^.!?]+)[.!?]/g;
	for (const f of prose(a)) {
		let m: RegExpExecArray | null;
		while ((m = re.exec(f.value)) !== null) {
			const rest = m[2];
			const segment = rest.split(",")[0].trim();
			const tokens = segment.split(/\s+/).filter(Boolean);
			const nextWord = (tokens[0] ?? "").toLowerCase().replace(/[^a-z']/g, "");

			const shortAttributive = tokens.length <= 1;
			const verbal = PARTICIPIAL_VERBAL_HEADWORDS.has(nextWord);
			const subjectFinite =
				!verbal &&
				tokens.some((t) =>
					PARTICIPIAL_FINITE_VERBS.has(t.toLowerCase().replace(/[^a-z']/g, "")),
				);

			if (shortAttributive || subjectFinite) continue;

			hits.push({
				rule: "participial-closure",
				field: f.name,
				span: m[0].trim(),
				severity: "high",
			});
		}
	}
	return hits;
};

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

// Slots may be short phrases (up to 4 words), not just single words, since AI prose
// favors phrasal triplets ("a cry for help, a fist raised, and a quiet goodbye").
const TRIPLE_SLOT = "[\\w'-]+(?:\\s+[\\w'-]+){0,3}";

export const ruleOfThree = (a: SongAnalysisLyrical): RuleHit[] =>
	matchRegexHits(
		prose(a),
		"rule-of-three",
		"low",
		new RegExp(`\\b${TRIPLE_SLOT},\\s+${TRIPLE_SLOT},\\s+and\\s+${TRIPLE_SLOT}\\b`, "gi"),
	);

// Function words whose repetition is normal — only content-word repetition is the
// tell. Tokens under three letters are dropped too, so "us", "go", contraction
// remnants ("it's" → "it" + dropped "s") never count.
const LEXICAL_STOPWORDS = new Set([
	"the", "a", "an", "this", "that", "these", "those", "it", "its", "he", "she",
	"they", "them", "his", "her", "their", "your", "our", "we", "you", "and",
	"or", "but", "nor", "so", "then", "than", "too", "very", "just", "only",
	"also", "even", "still", "yet", "of", "to", "in", "on", "at", "by", "for",
	"with", "from", "into", "over", "under", "up", "down", "out", "off", "as",
	"is", "are", "was", "were", "be", "been", "being", "am", "do", "does", "did",
	"have", "has", "had", "will", "would", "can", "could", "may", "might", "must",
	"should", "not", "no", "all", "any", "each", "both", "some", "such", "same",
	"who", "whom", "whose", "which", "what", "when", "where", "why", "how",
	"there", "here", "one", "about", "after", "before", "through", "between",
	"against", "beyond", "within", "without", "around", "across", "toward",
	"towards", "upon", "behind", "beside", "among", "throughout", "during",
	"despite", "because", "although", "though", "however", "whether", "while",
	"since", "until", "unless", "rather", "onto", "amid",
]);

export const LEXICAL_REPETITION_MIN = 3;

// The literature's most-replicated lexical finding: AI text reuses content words
// more than human text (Simon et al. 2023; André et al. 2023). We pool the prose,
// drop function words, and flag any content word repeated three or more times.
export const lexicalRepetition = (a: SongAnalysisLyrical): RuleHit[] => {
	const seen = new Map<string, { count: number; field: string }>();
	for (const f of prose(a)) {
		const words = f.value.toLowerCase().match(/[a-z]{2,}/g) ?? [];
		for (const w of words) {
			if (w.length < 3 || LEXICAL_STOPWORDS.has(w)) continue;
			const entry = seen.get(w);
			if (entry) entry.count += 1;
			else seen.set(w, { count: 1, field: f.name });
		}
	}
	const hits: RuleHit[] = [];
	for (const [word, { count, field }] of seen) {
		if (count >= LEXICAL_REPETITION_MIN) {
			hits.push({
				rule: "lexical-repetition",
				field,
				span: word,
				severity: "low",
				note: `repeated ×${count} across prose`,
			});
		}
	}
	return hits;
};

// Em dash, en dash, and prose hyphens. The brand prefers commas over em dashes, and
// recent practitioner consensus treats the dash as an AI-writing tell, so the analysis
// voice uses none. (This rests on brand preference + practitioner consensus, not the
// academic survey — GPT-3.5-era text actually used *fewer* dashes than humans.)
// Em/en dashes and a spaced hyphen (a dash in disguise) are the strong tell → medium.
// Intra-word hyphens ("late-night") are sometimes legitimate but the brand wants them
// rephrased → low. collectStringFields excludes key_lines[].line, so a hyphen inside a
// quoted lyric is never penalised — only the model's own voice is.
const DASH_CHARS = /[‒–—―−]/g;

function hyphenSpan(value: string, index: number): string {
	let start = index;
	let end = index + 1;
	while (start > 0 && /[A-Za-z0-9]/.test(value[start - 1])) start--;
	while (end < value.length && /[A-Za-z0-9-]/.test(value[end])) end++;
	return value.slice(start, end);
}

export const dashes = (a: SongAnalysisLyrical): RuleHit[] => {
	const hits: RuleHit[] = [];
	for (const f of collectStringFields(a)) {
		const value = f.value;
		let m: RegExpExecArray | null;

		const dashRe = new RegExp(DASH_CHARS.source, "g");
		while ((m = dashRe.exec(value)) !== null) {
			hits.push({ rule: "dash", field: f.name, span: m[0], severity: "medium" });
		}

		const hyphenRe = /-/g;
		while ((m = hyphenRe.exec(value)) !== null) {
			const i = m.index;
			const intraWord =
				/[A-Za-z0-9]/.test(value[i - 1] ?? "") && /[A-Za-z0-9]/.test(value[i + 1] ?? "");
			hits.push({
				rule: "dash",
				field: f.name,
				span: intraWord ? hyphenSpan(value, i) : "-",
				severity: intraWord ? "low" : "medium",
			});
		}
	}
	return hits;
};

export const ALL_RULES = [
	antithesis,
	copulaAvoidance,
	pufferyAdjective,
	aiVocabulary,
	participialClosure,
	hedging,
	academicRegister,
	selfReference,
	bookReportOpener,
	burstiness,
	ruleOfThree,
	lexicalRepetition,
	dashes,
] as const;

export function runAllRules(analysis: SongAnalysisLyrical): RuleHit[] {
	return ALL_RULES.flatMap((r) => r(analysis));
}
