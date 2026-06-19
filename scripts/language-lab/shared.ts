/**
 * Shared pieces for the language-detection benchmark: lyric-text cleaning,
 * ISO-code normalization, and a uniform adapter over the three detectors so the
 * benchmark can call them the same way and time them fairly.
 */
import { eld } from "eld";
import { detectAll as tinyldDetectAll } from "tinyld";
import { getLIDModel } from "fasttext.wasm.js";

export interface PoolRow {
	song_id: string;
	title: string;
	artist: string;
	lyrics_text: string;
}

export interface Prediction {
	/** Canonical comparison code: ISO 639-1 when available, else 639-3. */
	code: string;
	/** Top-1 confidence in [0,1] (semantics differ slightly per tool). */
	confidence: number;
}

export interface Detector {
	name: string;
	detect: (text: string) => Promise<Prediction>;
}

/**
 * Lyrics arrive as joined line text. Strip bracketed/parenthetical section
 * markers ([Chorus], (x2)), collapse whitespace, and cap length — detection is
 * a whole-document task and the first ~3k chars decide it, so the cap keeps the
 * speed comparison about the model, not about feeding it novels.
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

// tinyld and eld already emit ISO 639-1. fastText emits a Wikipedia/639-1-ish
// code that the wrapper resolves to alpha2/alpha3 for us. Comparison key is the
// 2-letter code whenever a tool can produce one.
export function makeDetectors(): Promise<Detector[]> {
	return (async () => {
		// The published `eld` export is typed as a union where `load` only exists on
		// the dynamic build. Guard it at runtime instead of asserting across the type.
		if (!isEldLoader(eld)) {
			throw new Error("eld loader unavailable");
		}
		await eld.load("large");
		const lid = await getLIDModel();

		const tinyld: Detector = {
			name: "tinyld",
			detect: async (text) => {
				const top = tinyldDetectAll(text)[0];
				return { code: top?.lang ?? "und", confidence: top?.accuracy ?? 0 };
			},
		};

		const eldDetector: Detector = {
			name: "eld",
			detect: async (text) => {
				const r = eld.detect(text);
				const conf = r.language ? (r.getScores()[r.language] ?? 0) : 0;
				return { code: r.language || "und", confidence: conf };
			},
		};

		const fasttext: Detector = {
			name: "fasttext",
			detect: async (text) => {
				const top = await lid.identify(text);
				return { code: top.alpha2 ?? top.alpha3, confidence: Number(top.possibility) };
			},
		};

		return [tinyld, eldDetector, fasttext];
	})();
}

/** ISO 639-1 → human label for the few we expect; falls back to the code. */
export const LANG_NAMES: Record<string, string> = {
	en: "English", es: "Spanish", pt: "Portuguese", fr: "French", de: "German",
	it: "Italian", ko: "Korean", ja: "Japanese", zh: "Chinese", ru: "Russian",
	nl: "Dutch", sv: "Swedish", no: "Norwegian", da: "Danish", fi: "Finnish",
	pl: "Polish", tr: "Turkish", ar: "Arabic", he: "Hebrew", hi: "Hindi",
	id: "Indonesian", ca: "Catalan", tl: "Tagalog", ro: "Romanian", el: "Greek",
	hu: "Hungarian", fa: "Persian", cs: "Czech", uk: "Ukrainian", th: "Thai",
};

export function langName(code: string): string {
	return LANG_NAMES[code] ?? code;
}
