/**
 * Lyric language detection with `eld` (Efficient Language Detector) — a pure-JS
 * n-gram detector with no model file and no network. Chosen over tinyld and
 * fastText after a benchmark on 45 real songs (see scripts/language-lab): on
 * whole-lyric text eld led on both accuracy and speed.
 *
 * `eld` holds a single global n-gram database, so the model is a module
 * singleton loaded once (the "large" db — best accuracy). Detection is sync
 * after load.
 */
import { eld } from "eld";

export interface LanguageDetection {
	/** ISO 639-1 (occasionally 639-3) primary language, or null if undetectable. */
	language: string | null;
	/** Top-1 confidence in [0,1]. */
	confidence: number;
	/** Second language for genuinely bilingual / code-switched lyrics, else null. */
	secondary: string | null;
}

const EMPTY: LanguageDetection = {
	language: null,
	confidence: 0,
	secondary: null,
};

// Below this much lyric text, detection is unreliable (instrumental tags, a
// single ad-lib line) — record the song as checked rather than guess.
const MIN_TEXT_CHARS = 100;
// eld's top score is an n-gram similarity, not a probability; reliable hits in
// the benchmark sat well above this. Paired with eld's own isReliable() gate.
const CONFIDENCE_FLOOR = 0.3;

// Secondary detection: split the lyrics into chunks and detect each. A second
// language only counts when it actually wins a share of the song — this catches
// "Catalan verses + English lines" and "English verses with parenthetical French"
// without the false positives a single-pass runner-up score would produce.
const CHUNK_TARGET_CHARS = 250;
const MAX_CHUNKS = 6;
const SECONDARY_MIN_SHARE = 0.3;
const SECONDARY_MIN_CHUNKS = 2;

interface EldLoader {
	load: (name: string) => Promise<unknown>;
}

function isEldLoader(value: unknown): value is EldLoader {
	return (
		typeof value === "object" &&
		value !== null &&
		"load" in value &&
		typeof value.load === "function"
	);
}

let loaded: Promise<void> | null = null;
function ensureLoaded(): Promise<void> {
	// The published `eld` export is typed as a union where `load` lives only on
	// the dynamic build. Guard it at runtime instead of asserting across the type.
	if (loaded) return loaded;
	if (!isEldLoader(eld)) {
		return Promise.reject(new Error("eld loader unavailable"));
	}
	loaded = eld.load("large").then(() => undefined);
	return loaded;
}

/**
 * Strip bracketed/parenthetical section markers ([Chorus], (x2)), collapse
 * whitespace, and cap length. Detection is a whole-document task; the first few
 * thousand chars decide it, so the cap bounds cost without hurting accuracy.
 */
export function cleanLyrics(raw: string): string {
	return raw
		.split("\n")
		.map((l) => l.replace(/^\s*[[(].*?[\])]\s*$/g, "").trim())
		.filter(Boolean)
		.join(" ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 3000);
}

function chunk(text: string): string[] {
	const n = Math.min(
		MAX_CHUNKS,
		Math.max(1, Math.floor(text.length / CHUNK_TARGET_CHARS)),
	);
	if (n <= 1) return [text];
	const size = Math.ceil(text.length / n);
	const out: string[] = [];
	for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
	return out;
}

function detectSecondary(text: string, primary: string): string | null {
	const chunks = chunk(text);
	if (chunks.length < SECONDARY_MIN_CHUNKS) return null;

	const votes = new Map<string, number>();
	for (const c of chunks) {
		const r = eld.detect(c);
		if (r.language && r.isReliable())
			votes.set(r.language, (votes.get(r.language) ?? 0) + 1);
	}

	let best: string | null = null;
	let bestCount = 0;
	for (const [lang, count] of votes) {
		if (lang === primary) continue;
		if (count > bestCount) {
			best = lang;
			bestCount = count;
		}
	}
	const meetsShare =
		bestCount >= SECONDARY_MIN_CHUNKS &&
		bestCount / chunks.length >= SECONDARY_MIN_SHARE;
	return meetsShare ? best : null;
}

/**
 * Detect the primary (and any strong secondary) language of a song's lyrics.
 * Returns language=null (with whatever confidence) when the text is too short or
 * eld deems the result unreliable — the caller still stamps the song as checked.
 */
export async function detectLanguage(
	rawLyrics: string,
): Promise<LanguageDetection> {
	const text = cleanLyrics(rawLyrics);
	if (text.length < MIN_TEXT_CHARS) return EMPTY;

	await ensureLoaded();

	const result = eld.detect(text);
	const language = result.language || null;
	const confidence = language ? (result.getScores()[language] ?? 0) : 0;

	if (!language || !result.isReliable() || confidence < CONFIDENCE_FLOOR) {
		return { language: null, confidence, secondary: null };
	}

	return { language, confidence, secondary: detectSecondary(text, language) };
}
