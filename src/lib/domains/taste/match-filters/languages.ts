/**
 * Checked-in language catalog for match-filter language selection.
 *
 * Covers all 60 ISO 639-1 codes that `eld` (the lyric language detector) can
 * emit plus additional commonly-filterable languages. Each entry has a canonical
 * English label and optional aliases/endonyms to make search more user-friendly
 * (e.g. searching "Deutsch" finds German).
 *
 * Ordering for the picker is: selected first, then detected by count descending,
 * then catalog-only alphabetically by label. The `orderLanguageOptions` helper
 * implements this given a detected-count map.
 */

import type { MatchFilterLanguageOption } from "./types";

type CatalogEntry = {
	code: string;
	label: string;
	aliases: string[];
};

const CATALOG: CatalogEntry[] = [
	{ code: "af", label: "Afrikaans", aliases: [] },
	{ code: "am", label: "Amharic", aliases: ["አማርኛ"] },
	{ code: "ar", label: "Arabic", aliases: ["العربية"] },
	{ code: "az", label: "Azerbaijani", aliases: ["Azərbaycan"] },
	{ code: "be", label: "Belarusian", aliases: ["Беларуская"] },
	{ code: "bg", label: "Bulgarian", aliases: ["Български"] },
	{ code: "bn", label: "Bengali", aliases: ["বাংলা"] },
	{ code: "bs", label: "Bosnian", aliases: ["Bosanski"] },
	{ code: "ca", label: "Catalan", aliases: ["Català"] },
	{ code: "cs", label: "Czech", aliases: ["Čeština"] },
	{ code: "cy", label: "Welsh", aliases: ["Cymraeg"] },
	{ code: "da", label: "Danish", aliases: ["Dansk"] },
	{ code: "de", label: "German", aliases: ["Deutsch"] },
	{ code: "el", label: "Greek", aliases: ["Ελληνικά"] },
	{ code: "en", label: "English", aliases: [] },
	{ code: "es", label: "Spanish", aliases: ["Español", "Castellano"] },
	{ code: "et", label: "Estonian", aliases: ["Eesti"] },
	{ code: "eu", label: "Basque", aliases: ["Euskara"] },
	{ code: "fa", label: "Persian", aliases: ["فارسی", "Farsi"] },
	{ code: "fi", label: "Finnish", aliases: ["Suomi"] },
	{ code: "fr", label: "French", aliases: ["Français"] },
	{ code: "ga", label: "Irish", aliases: ["Gaeilge"] },
	{ code: "gl", label: "Galician", aliases: ["Galego"] },
	{ code: "gu", label: "Gujarati", aliases: ["ગુજરાતી"] },
	{ code: "he", label: "Hebrew", aliases: ["עברית"] },
	{ code: "hi", label: "Hindi", aliases: ["हिन्दी"] },
	{ code: "hr", label: "Croatian", aliases: ["Hrvatski"] },
	{ code: "hu", label: "Hungarian", aliases: ["Magyar"] },
	{ code: "hy", label: "Armenian", aliases: ["Հայերեն"] },
	{ code: "id", label: "Indonesian", aliases: ["Bahasa Indonesia"] },
	{ code: "is", label: "Icelandic", aliases: ["Íslenska"] },
	{ code: "it", label: "Italian", aliases: ["Italiano"] },
	{ code: "ja", label: "Japanese", aliases: ["日本語"] },
	{ code: "ka", label: "Georgian", aliases: ["ქართული"] },
	{ code: "kk", label: "Kazakh", aliases: ["Қазақша"] },
	{ code: "km", label: "Khmer", aliases: ["ខ្មែរ"] },
	{ code: "kn", label: "Kannada", aliases: ["ಕನ್ನಡ"] },
	{ code: "ko", label: "Korean", aliases: ["한국어"] },
	{ code: "ku", label: "Kurdish", aliases: ["Kurdî", "کوردی"] },
	{ code: "lo", label: "Lao", aliases: ["ລາວ"] },
	{ code: "lt", label: "Lithuanian", aliases: ["Lietuvių"] },
	{ code: "lv", label: "Latvian", aliases: ["Latviešu"] },
	{ code: "mk", label: "Macedonian", aliases: ["Македонски"] },
	{ code: "ml", label: "Malayalam", aliases: ["മലയാളം"] },
	{ code: "mn", label: "Mongolian", aliases: ["Монгол"] },
	{ code: "mr", label: "Marathi", aliases: ["मराठी"] },
	{ code: "ms", label: "Malay", aliases: ["Bahasa Melayu"] },
	{ code: "mt", label: "Maltese", aliases: ["Malti"] },
	{ code: "my", label: "Burmese", aliases: ["မြန်မာ"] },
	{ code: "nb", label: "Norwegian Bokmål", aliases: ["Norsk"] },
	{ code: "ne", label: "Nepali", aliases: ["नेपाली"] },
	{ code: "nl", label: "Dutch", aliases: ["Nederlands"] },
	{ code: "no", label: "Norwegian", aliases: ["Norsk"] },
	{ code: "or", label: "Oriya", aliases: ["ଓଡ଼ିଆ"] },
	{ code: "pa", label: "Punjabi", aliases: ["ਪੰਜਾਬੀ", "پنجابی"] },
	{ code: "pl", label: "Polish", aliases: ["Polski"] },
	{ code: "ps", label: "Pashto", aliases: ["پښتو"] },
	{ code: "pt", label: "Portuguese", aliases: ["Português"] },
	{ code: "ro", label: "Romanian", aliases: ["Română"] },
	{ code: "ru", label: "Russian", aliases: ["Русский"] },
	{ code: "si", label: "Sinhala", aliases: ["සිංහල"] },
	{ code: "sk", label: "Slovak", aliases: ["Slovenčina"] },
	{ code: "sl", label: "Slovene", aliases: ["Slovenščina"] },
	{ code: "sq", label: "Albanian", aliases: ["Shqip"] },
	{ code: "sr", label: "Serbian", aliases: ["Српски"] },
	{ code: "sv", label: "Swedish", aliases: ["Svenska"] },
	{ code: "sw", label: "Swahili", aliases: ["Kiswahili"] },
	{ code: "ta", label: "Tamil", aliases: ["தமிழ்"] },
	{ code: "te", label: "Telugu", aliases: ["తెలుగు"] },
	{ code: "th", label: "Thai", aliases: ["ภาษาไทย"] },
	{ code: "tl", label: "Tagalog", aliases: ["Filipino"] },
	{ code: "tr", label: "Turkish", aliases: ["Türkçe"] },
	{ code: "uk", label: "Ukrainian", aliases: ["Українська"] },
	{ code: "ur", label: "Urdu", aliases: ["اردو"] },
	{ code: "uz", label: "Uzbek", aliases: ["Oʻzbekcha"] },
	{ code: "vi", label: "Vietnamese", aliases: ["Tiếng Việt"] },
	{ code: "yo", label: "Yoruba", aliases: [] },
	{
		code: "zh",
		label: "Chinese",
		aliases: ["中文", "普通话", "Mandarin", "Cantonese", "粤语"],
	},
	{ code: "zu", label: "Zulu", aliases: ["isiZulu"] },
];

const CATALOG_BY_CODE = new Map<string, CatalogEntry>(
	CATALOG.map((entry) => [entry.code, entry]),
);

export const SUPPORTED_LANGUAGE_CODES: ReadonlySet<string> = new Set(
	CATALOG.map((e) => e.code),
);

export function lookupLanguage(
	code: string,
): MatchFilterLanguageOption | undefined {
	const entry = CATALOG_BY_CODE.get(code);
	if (!entry) return undefined;
	return { code: entry.code, label: entry.label };
}

/**
 * Display label for a single language code, falling back to the raw code when
 * lookup fails (shouldn't happen for stored, catalog-validated codes).
 */
export function languageLabel(code: string): string {
	return lookupLanguage(code)?.label ?? code;
}

export function isLanguageCatalogCode(code: string): boolean {
	return CATALOG_BY_CODE.has(code);
}

function normalize(s: string): string {
	return s.toLowerCase().trim();
}

/**
 * Search the catalog by code, canonical English label, or alias/endonym.
 * Returns all matching entries as options sorted alphabetically by label.
 */
export function searchLanguages(query: string): MatchFilterLanguageOption[] {
	const q = normalize(query);
	if (!q) {
		return CATALOG.map((e) => ({ code: e.code, label: e.label }));
	}
	return CATALOG.filter(
		(e) =>
			normalize(e.code).includes(q) ||
			normalize(e.label).includes(q) ||
			e.aliases.some((a) => normalize(a).includes(q)),
	)
		.map((e) => ({ code: e.code, label: e.label }))
		.sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Order language options for the picker:
 * 1. Selected codes (in the order they were selected).
 * 2. Detected-but-not-selected languages, sorted by count descending.
 * 3. Catalog-only (not detected, not selected) alphabetically by label.
 *
 * The `detectedCounts` map must contain only codes present in the catalog;
 * uncataloged detected codes should be filtered out before calling.
 */
export function orderLanguageOptions(
	selectedCodes: string[],
	detectedCounts: Map<string, number>,
): MatchFilterLanguageOption[] {
	const selectedSet = new Set(selectedCodes);

	const selected: MatchFilterLanguageOption[] = selectedCodes
		.map((code) => lookupLanguage(code))
		.filter((opt): opt is MatchFilterLanguageOption => opt !== undefined);

	const detectedNotSelected: Array<{
		opt: MatchFilterLanguageOption;
		count: number;
	}> = [];
	for (const [code, count] of detectedCounts) {
		if (selectedSet.has(code)) continue;
		const opt = lookupLanguage(code);
		if (opt) detectedNotSelected.push({ opt, count });
	}
	detectedNotSelected.sort(
		(a, b) => b.count - a.count || a.opt.label.localeCompare(b.opt.label),
	);

	const detectedOrSelectedCodes = new Set([
		...selectedCodes,
		...detectedCounts.keys(),
	]);
	const catalogOnly: MatchFilterLanguageOption[] = CATALOG.filter(
		(e) => !detectedOrSelectedCodes.has(e.code),
	)
		.map((e) => ({ code: e.code, label: e.label }))
		.sort((a, b) => a.label.localeCompare(b.label));

	return [
		...selected,
		...detectedNotSelected.map((d) => d.opt),
		...catalogOnly,
	];
}
