import type { SongRead } from "@/lib/domains/enrichment/content-analysis/read-schema";
import { sentenceLengthCV, splitSentences } from "./burstiness";
import type { RuleHit, Severity } from "./rules-types";

export const BURSTINESS_CV_THRESHOLD = 0.25;

interface StringField {
	name: string;
	value: string;
}

// Every model-authored string in the read. The `lines` array is excluded entirely:
// it now carries only the artist's quoted words (the per-line insight gloss was
// removed), and penalising a hyphen inside a lyric quote would be wrong. The
// `dashes` rule walks this full set.
function collectStringFields(a: SongRead): StringField[] {
	const out: StringField[] = [
		{ name: "image", value: a.image },
		{ name: "lens", value: a.lens },
		{ name: "tension", value: a.tension },
		{ name: "take", value: a.take },
	];
	if (a.contradiction !== null) {
		out.push({ name: "contradiction", value: a.contradiction });
	}
	if (a.texture !== null) {
		out.push({ name: "texture", value: a.texture });
	}
	a.arc.forEach((beat, i) => {
		out.push({ name: `arc[${i}].label`, value: beat.label });
		out.push({ name: `arc[${i}].mood`, value: beat.mood });
		out.push({ name: `arc[${i}].scene`, value: beat.scene });
	});
	return out;
}

// Full-sentence prose only. The short label fields — `tension` (two-word A+N), `lens`
// (the 2-6 word framing phrase), and each arc beat's `label`/`mood` — are excluded the
// way `compound_mood`/`.section`/`.mood` were: the AI-slop regexes are built for
// sentences and misfire on labels. `lens` quality is graded by the lens-coherence
// judge, not these deterministic rules.
function prose(a: SongRead): StringField[] {
	return collectStringFields(a).filter(
		(f) =>
			f.name !== "tension" &&
			f.name !== "lens" &&
			!f.name.endsWith(".label") &&
			!f.name.endsWith(".mood"),
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
		const re = new RegExp(
			pattern.source,
			pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
		);
		for (let m = re.exec(f.value); m !== null; m = re.exec(f.value)) {
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
		for (let m = copy.exec(f.value); m !== null; m = copy.exec(f.value)) {
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
const ANTITHESIS_NEGATION_LIST =
	/\bno\s+[\w'-]+,\s+no\s+[\w'-]+,\s+(?:just|only)\b/gi;

// The CROSS-SENTENCE thesis-pivot the single-sentence ANTITHESIS_FRAME misses (its `[^.]*?` stops
// at the period). The dominant AI tell in the Phase-4 voice audit: a negated copular clause ends a
// sentence, then the next sentence RE-ASSERTS with a copula — "This is not a diss track. It is
// testifying.", "The song is not a celebration. It is a prayer." The pronoun-plus-copula
// re-assertion ("It is…", "He's a…") is the signature: ordinary narrative continues with an action
// verb ("She is not ready. She drives anyway.") and the golds' legitimate contrasts ("could never
// be bought, only inherited"; "the door stays shut, not slammed") have no "is not … It is" shape,
// so both are left alone. Verified 0 hits across all 9 golds; catches the pivot on the v17/pro
// candidates that lose the pairwise while reading tier1-clean. HIGH, like the rest of antithesis.
const ANTITHESIS_CROSS_SENTENCE =
	/\b(?:(?:is|are|was|were|it'?s|he'?s|she'?s|they'?re|this is|that'?s)\s+not|isn'?t|aren'?t|wasn'?t|weren'?t)\b[^.!?]*[.!?]+\s+(?:it|this|that|he|she|they)(?:'?s|'?re)?\s+(?:is|are|was|were|a|an|the|just|simply|really)\b/gi;

export const antithesis = (a: SongRead): RuleHit[] => [
	...matchRegexHits(prose(a), "antithesis", "high", ANTITHESIS_FRAME),
	...matchRegexHits(prose(a), "antithesis", "high", ANTITHESIS_NEGATION_LIST),
	...matchRegexHits(prose(a), "antithesis", "high", ANTITHESIS_CROSS_SENTENCE),
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

export const copulaAvoidance = (a: SongRead): RuleHit[] =>
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

export const pufferyAdjective = (a: SongRead): RuleHit[] =>
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
export const aiVocabulary = (a: SongRead): RuleHit[] => {
	const hits = matchWordList(
		prose(a),
		"ai-vocabulary",
		"medium",
		AI_VOCABULARY,
	);
	const distinct = new Set(hits.map((h) => h.span.toLowerCase()));
	return distinct.size >= 2 ? hits : [];
};

// Words that, immediately after the -ing token, mark it as a VERB taking a complement
// — i.e. a genuine tacked-on participial clause ("rallying a collective", "hinting at danger").
const PARTICIPIAL_VERBAL_HEADWORDS = new Set([
	"a",
	"an",
	"the",
	"this",
	"that",
	"these",
	"those",
	"its",
	"his",
	"her",
	"their",
	"your",
	"my",
	"our",
	"it",
	"them",
	"everyone",
	"anyone",
	"everything",
	"nothing",
	"no",
	"all",
	"into",
	"to",
	"of",
	"at",
	"with",
	"for",
	"on",
	"against",
	"through",
	"over",
	"as",
	"away",
	"down",
	"up",
	"out",
	"in",
	"upon",
	"toward",
	"towards",
	"like",
]);

// Present-tense finite verbs that, following a bare noun, reveal the comma clause is
// actually a main clause whose subject carries an -ing ADJECTIVE ("thumping bassline drives ...").
const PARTICIPIAL_FINITE_VERBS = new Set([
	"drives",
	"gives",
	"pulls",
	"sets",
	"makes",
	"takes",
	"builds",
	"creates",
	"turns",
	"brings",
	"leaves",
	"hangs",
	"swells",
	"kicks",
	"cuts",
	"pushes",
	"carries",
	"fills",
	"floats",
	"echoes",
	"becomes",
	"feels",
	"sounds",
	"moves",
	"runs",
	"hits",
	"lands",
	"breaks",
	"holds",
	"keeps",
	"begins",
	"emerges",
	"appears",
	"rises",
	"falls",
	"grows",
	"fades",
	"shifts",
	"returns",
	"follows",
	"continues",
	"signals",
	"confirms",
	"opens",
	"closes",
	"drops",
	"explodes",
	"sits",
	"comes",
	"goes",
	"stays",
	"remains",
	"plays",
	"anchors",
	"underpins",
	"propels",
	"powers",
	"pulses",
	"throbs",
	"thumps",
	"pounds",
	"provides",
	"provide",
	"adds",
	"add",
]);

// Flags an -ing clause tacked onto a sentence end ("..., revealing the cost of pride.").
// Skips two look-alikes that aren't the tell: a short attributive tail ("..., knocking drums.")
// and a subject modified by an -ing adjective ("..., thumping bassline drives the rhythm.").
export const participialClosure = (a: SongRead): RuleHit[] => {
	const hits: RuleHit[] = [];
	const re = /[,;]\s+([A-Za-z][A-Za-z']*ing)\s+([^.!?]+)[.!?]/g;
	for (const f of prose(a)) {
		for (let m = re.exec(f.value); m !== null; m = re.exec(f.value)) {
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

export const hedging = (a: SongRead): RuleHit[] =>
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

export const academicRegister = (a: SongRead): RuleHit[] =>
	matchWordList(prose(a), "academic-register", "high", ACADEMIC_TERMS);

const SELF_REFERENCE_TERMS = [
	"this song",
	"the track",
	"the album",
	"the listener",
	"the speaker",
	"the narrator",
	"the singer",
	"the vocalist",
];

export const selfReference = (a: SongRead): RuleHit[] =>
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
	"This song is",
	"This isn't",
	"It's not just",
	"It's",
	"It is",
	"More than a",
];

export const bookReportOpener = (a: SongRead): RuleHit[] => {
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

const STRUCTURAL_SECTION_TERMS = [
	"refrain",
	"verse",
	"chorus",
	"bridge",
	"hook",
	"intro",
	"outro",
	"pre-chorus",
	"pre chorus",
];

// Section names belong to arc `label`s ("The Reckoning"), not interpretive prose. `texture`
// is excluded — it's the sound field, where a musical term names a motif ("underneath each
// hook"), not song structure. `lens`/`tension`/`label`/`mood`/`lines` already sit outside
// `prose()`.
export const structuralSection = (a: SongRead): RuleHit[] =>
	matchWordList(
		prose(a).filter((f) => f.name !== "texture"),
		"structural-section",
		"high",
		STRUCTURAL_SECTION_TERMS,
	);

// A `mood` is a qualified emotion (>=2 words); only the lone bare word ("Yearning") fails.
export const moodWidth = (a: SongRead): RuleHit[] => {
	const hits: RuleHit[] = [];
	a.arc.forEach((beat, i) => {
		const words = beat.mood.trim().split(/\s+/).filter(Boolean);
		if (words.length < 2) {
			hits.push({
				rule: "mood-width",
				field: `arc[${i}].mood`,
				span: beat.mood,
				severity: "medium",
			});
		}
	});
	return hits;
};

// A `mood` repeating `tension` verbatim means one of the two fields is dead. Exact,
// case-insensitive — a near-miss ("Aching Warmth" vs "Aching Nostalgia") is honest variation.
export const tensionMoodDedup = (a: SongRead): RuleHit[] => {
	const tension = a.tension.trim().toLowerCase();
	const hits: RuleHit[] = [];
	a.arc.forEach((beat, i) => {
		if (beat.mood.trim().toLowerCase() === tension) {
			hits.push({
				rule: "tension-mood-dedup",
				field: `arc[${i}].mood`,
				span: beat.mood,
				severity: "medium",
				note: `duplicates tension "${a.tension}"`,
			});
		}
	});
	return hits;
};

export const burstiness = (a: SongRead): RuleHit[] => {
	const hits: RuleHit[] = [];
	const longFields: StringField[] = [
		{ name: "take", value: a.take },
		...(a.texture !== null ? [{ name: "texture", value: a.texture }] : []),
		...a.arc.map((beat, i) => ({
			name: `arc[${i}].scene`,
			value: beat.scene,
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

export const ruleOfThree = (a: SongRead): RuleHit[] =>
	matchRegexHits(
		prose(a),
		"rule-of-three",
		"low",
		new RegExp(
			`\\b${TRIPLE_SLOT},\\s+${TRIPLE_SLOT},\\s+and\\s+${TRIPLE_SLOT}\\b`,
			"gi",
		),
	);

// Function words whose repetition is normal — only content-word repetition is the
// tell. Tokens under three letters are dropped too, so "us", "go", contraction
// remnants ("it's" → "it" + dropped "s") never count.
const LEXICAL_STOPWORDS = new Set([
	"the",
	"a",
	"an",
	"this",
	"that",
	"these",
	"those",
	"it",
	"its",
	"he",
	"she",
	"they",
	"them",
	"his",
	"her",
	"their",
	"your",
	"our",
	"we",
	"you",
	"and",
	"or",
	"but",
	"nor",
	"so",
	"then",
	"than",
	"too",
	"very",
	"just",
	"only",
	"also",
	"even",
	"still",
	"yet",
	"of",
	"to",
	"in",
	"on",
	"at",
	"by",
	"for",
	"with",
	"from",
	"into",
	"over",
	"under",
	"up",
	"down",
	"out",
	"off",
	"as",
	"is",
	"are",
	"was",
	"were",
	"be",
	"been",
	"being",
	"am",
	"do",
	"does",
	"did",
	"have",
	"has",
	"had",
	"will",
	"would",
	"can",
	"could",
	"may",
	"might",
	"must",
	"should",
	"not",
	"no",
	"all",
	"any",
	"each",
	"both",
	"some",
	"such",
	"same",
	"who",
	"whom",
	"whose",
	"which",
	"what",
	"when",
	"where",
	"why",
	"how",
	"there",
	"here",
	"one",
	"about",
	"after",
	"before",
	"through",
	"between",
	"against",
	"beyond",
	"within",
	"without",
	"around",
	"across",
	"toward",
	"towards",
	"upon",
	"behind",
	"beside",
	"among",
	"throughout",
	"during",
	"despite",
	"because",
	"although",
	"though",
	"however",
	"whether",
	"while",
	"since",
	"until",
	"unless",
	"rather",
	"onto",
	"amid",
]);

export const LEXICAL_REPETITION_MIN = 3;

// The literature's most-replicated lexical finding: AI text reuses content words
// more than human text (Simon et al. 2023; André et al. 2023). We pool the prose,
// drop function words, and flag any content word repeated three or more times.
export const lexicalRepetition = (a: SongRead): RuleHit[] => {
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

// Em dash, en dash, and a spaced hyphen used as a dash. A trailing em dash ending a clause
// abruptly is the AI tell → medium; paired parenthetical em dashes (even count per field) are
// deliberate → low. Intra-word hyphens ("late-night", "neon-lit") are allowed.
// `collectStringFields` excludes `lines`, so a hyphen inside a quoted lyric is never flagged.
const DASH_CHARS = /[‒–—―−]/g;

export const dashes = (a: SongRead): RuleHit[] => {
	const hits: RuleHit[] = [];
	for (const f of collectStringFields(a)) {
		const value = f.value;

		const dashRe = new RegExp(DASH_CHARS.source, "g");
		const dashMatches: RegExpExecArray[] = [];
		for (let m = dashRe.exec(value); m !== null; m = dashRe.exec(value))
			dashMatches.push(m);
		const pairedCount = Math.floor(dashMatches.length / 2) * 2;
		dashMatches.forEach((match, idx) => {
			hits.push({
				rule: "dash",
				field: f.name,
				span: match[0],
				severity: idx < pairedCount ? "low" : "medium",
			});
		});

		const hyphenRe = /-/g;
		for (let m = hyphenRe.exec(value); m !== null; m = hyphenRe.exec(value)) {
			const i = m.index;
			const intraWord =
				/[A-Za-z0-9]/.test(value[i - 1] ?? "") &&
				/[A-Za-z0-9]/.test(value[i + 1] ?? "");
			// Intra-word hyphens ("late-night") are allowed; only a spaced hyphen standing
			// in for a dash ("first - then") is the tell.
			if (intraWord) continue;
			hits.push({ rule: "dash", field: f.name, span: "-", severity: "medium" });
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
	structuralSection,
	moodWidth,
	tensionMoodDedup,
	burstiness,
	ruleOfThree,
	lexicalRepetition,
	dashes,
] as const;

export function runAllRules(analysis: SongRead): RuleHit[] {
	return ALL_RULES.flatMap((r) => r(analysis));
}
