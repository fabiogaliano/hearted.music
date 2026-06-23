import { describe, expect, it } from "vitest";
import {
	bestFragmentMatch,
	buildLrclibStream,
	normalizeLyricText,
	tokenizeLyricText,
} from "../annotation-matcher";

// Real LRCLIB transcription of Sam Fender – "Rein Me In" (first stanzas),
// including the blank lines LRCLIB puts between stanzas. The Genius fragments
// tested against it diverge in exactly the ways production will see.
const LRCLIB_LINES = [
	"I let go of everything I ever had",
	"'Cause I couldn't give the love you deserved",
	'By The Gunner, you shouted, "Oh, my God"',
	"It seemed churlish, but it's what I was owed, I suppose",
	"",
	"Every flagstone of this town bears our prints",
	"And all the bars 'round here serve my ghosts and carcasses",
	"I wish I knew these things when I was young",
	"'Cause now I've just grown so numb",
	"",
	"We take whatever we can to get the reason back",
	"So please don't rein me in",
];

function matchedText(fragment: string): {
	text: string;
	score: number;
} | null {
	const match = bestFragmentMatch(fragment, LRCLIB_LINES);
	if (!match) return null;
	const text = LRCLIB_LINES.slice(match.startLine, match.endLine + 1).join(
		"\n",
	);
	return { text, score: match.score };
}

describe("normalizeLyricText", () => {
	it("folds a Cyrillic homoglyph to its ASCII twin", () => {
		// "plеase" here uses Cyrillic U+0435 for the first 'e'.
		expect(normalizeLyricText("So plеase don't rein me in")).toBe(
			normalizeLyricText("So please don't rein me in"),
		);
	});

	it("drops parenthesized ad-libs", () => {
		expect(normalizeLyricText("ring like tinnitus (My memories of you)")).toBe(
			"ring like tinnitus",
		);
	});

	it("elides apostrophes instead of splitting the word", () => {
		expect(tokenizeLyricText("'Cause I couldn't")).toEqual([
			"cause",
			"i",
			"couldnt",
		]);
	});

	it("collapses punctuation and case differences", () => {
		expect(normalizeLyricText('shouted, "Oh, my God"')).toBe(
			normalizeLyricText('shouted, "Oh my god"'),
		);
	});
});

describe("bestFragmentMatch", () => {
	it("matches a clean line at score 1.0", () => {
		const result = matchedText("I let go of everything I ever had");
		expect(result?.text).toBe("I let go of everything I ever had");
		expect(result?.score).toBe(1);
	});

	it("matches through a Cyrillic homoglyph in the fragment", () => {
		// Genius transcription carries the Cyrillic 'е'; LRCLIB has plain ASCII.
		const result = matchedText("So plеase don't rein me in");
		expect(result?.text).toBe("So please don't rein me in");
		expect(result?.score).toBe(1);
	});

	it("matches despite an ad-lib the fragment carries but LRCLIB omits", () => {
		const result = matchedText('By The Gunner, you shouted, "Oh my god"');
		expect(result?.text).toBe('By The Gunner, you shouted, "Oh, my God"');
		expect(result?.score).toBe(1);
	});

	it("tolerates a single transcribed-word disagreement (gone vs grown)", () => {
		const result = matchedText("'Cause now I've just gone so numb");
		expect(result?.text).toBe("'Cause now I've just grown so numb");
		// 7 tokens, 1 substitution → 1 − 1/7.
		expect(result?.score).toBeCloseTo(6 / 7, 5);
	});

	it("matches a sub-phrase referent against the full line it lives on", () => {
		const result = matchedText("ghosts and carcasses");
		expect(result?.text).toBe(
			"And all the bars 'round here serve my ghosts and carcasses",
		);
		expect(result?.score).toBe(1);
	});

	it("matches a multi-line fragment across consecutive lines", () => {
		const result = matchedText(
			"I wish I knew these things when I was young\n'Cause now I've just gone so numb",
		);
		expect(result?.text).toBe(
			"I wish I knew these things when I was young\n'Cause now I've just grown so numb",
		);
	});

	it("returns null when a fragment has no tokens after normalization", () => {
		expect(bestFragmentMatch("", LRCLIB_LINES)).toBeNull();
		// A purely parenthetical ad-lib strips to nothing — no span to attach to.
		expect(bestFragmentMatch("(ooh, ooh)", LRCLIB_LINES)).toBeNull();
	});

	it("scores absent text low so a floor can reject it", () => {
		// Section headers and unrelated text survive normalization but score low.
		expect(matchedText("[Verse 1]")?.score).toBeLessThan(0.5);
		const unrelated = matchedText("completely unrelated words nowhere in song");
		expect(unrelated).not.toBeNull();
		expect(unrelated?.score).toBeLessThan(0.5);
	});
});

describe("repeated-line ambiguity (documented limitation)", () => {
	// Local substring matching cannot disambiguate which occurrence of a repeated
	// chorus line a fragment belongs to; it returns the first. This is acceptable:
	// the formatter de-dups repeated annotations via back-references anyway.
	const REPEATED = [
		"Don't rein me in",
		"Please don't rein me in",
		"some other line",
		"Don't rein me in",
	];

	it("attaches a repeated line to its first occurrence", () => {
		const match = bestFragmentMatch("Don't rein me in", REPEATED);
		expect(match?.startLine).toBe(0);
		expect(match?.score).toBe(1);
	});
});

describe("buildLrclibStream reuse", () => {
	it("produces the same result as passing raw lines", () => {
		const stream = buildLrclibStream(LRCLIB_LINES);
		const viaStream = bestFragmentMatch(
			"I let go of everything I ever had",
			stream,
		);
		const viaLines = bestFragmentMatch(
			"I let go of everything I ever had",
			LRCLIB_LINES,
		);
		expect(viaStream).toEqual(viaLines);
	});
});
