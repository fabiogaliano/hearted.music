import { describe, expect, it } from "vitest";
import type { VocalsDetectionResult } from "../vocals-detector";
import { detectVocalGender } from "../vocals-detector";

function expectGender(text: string, kind: VocalsDetectionResult["kind"]): void {
	expect(detectVocalGender(text)).toEqual({ kind });
}

describe("no signal", () => {
	it("returns none for empty string", () => {
		expectGender("", "none");
	});

	it("returns none for unrelated text", () => {
		expectGender("chill lo-fi beats for studying", "none");
	});

	it("returns none for genre-only text", () => {
		expectGender("jazz piano trio", "none");
	});
});

describe("female keyword families", () => {
	it("detects 'female' standalone", () => {
		expectGender("songs with female vocals", "female");
	});

	it("detects 'woman'", () => {
		expectGender("woman singer jazz", "female");
	});

	it("detects 'women'", () => {
		expectGender("songs by women", "female");
	});

	it("detects 'girl'", () => {
		expectGender("indie girl bands", "female");
	});

	it("detects 'girls'", () => {
		expectGender("songs about girls", "female");
	});

	it("detects 'feminine'", () => {
		expectGender("feminine energy playlist", "female");
	});

	it("detects 'female vocals' phrase", () => {
		expectGender("upbeat songs with female vocals", "female");
	});

	it("detects 'female vocal' (singular)", () => {
		expectGender("searching for female vocal tracks", "female");
	});

	it("detects 'female voices'", () => {
		expectGender("I love female voices in pop", "female");
	});

	it("detects 'female voice' (singular)", () => {
		expectGender("beautiful female voice", "female");
	});

	it("detects 'female vocalist'", () => {
		expectGender("playlist with female vocalist only", "female");
	});

	it("detects 'female-fronted'", () => {
		expectGender("female-fronted metal", "female");
	});

	it("detects 'female fronted' (space variant)", () => {
		expectGender("female fronted rock", "female");
	});

	it("detects 'woman singer'", () => {
		expectGender("woman singer soul tracks", "female");
	});

	it("detects 'women singers'", () => {
		expectGender("women singers playlist", "female");
	});

	it("detects 'girl vocals'", () => {
		expectGender("indie pop girl vocals", "female");
	});

	it("detects 'girl vocal' (singular)", () => {
		expectGender("sweet girl vocal sound", "female");
	});
});

describe("male keyword families", () => {
	it("detects 'male' standalone", () => {
		expectGender("songs with male vocals", "male");
	});

	it("detects 'man'", () => {
		expectGender("man singer blues", "male");
	});

	it("detects 'men'", () => {
		expectGender("songs performed by men", "male");
	});

	it("detects 'boy'", () => {
		expectGender("boy band anthems", "male");
	});

	it("detects 'boys'", () => {
		expectGender("feel good songs about boys", "male");
	});

	it("detects 'masculine'", () => {
		expectGender("deep masculine voice", "male");
	});

	it("detects 'male vocals' phrase", () => {
		expectGender("rock tracks with male vocals", "male");
	});

	it("detects 'male vocal' (singular)", () => {
		expectGender("pure male vocal power", "male");
	});

	it("detects 'male voices'", () => {
		expectGender("I like male voices in choir", "male");
	});

	it("detects 'male voice' (singular)", () => {
		expectGender("deep male voice", "male");
	});

	it("detects 'male vocalist'", () => {
		expectGender("playlist with male vocalist", "male");
	});

	it("detects 'male-fronted'", () => {
		expectGender("male-fronted indie rock", "male");
	});

	it("detects 'male fronted' (space variant)", () => {
		expectGender("male fronted bands", "male");
	});

	it("detects 'man singer'", () => {
		expectGender("man singer with gravelly voice", "male");
	});

	it("detects 'men singers'", () => {
		expectGender("men singers only please", "male");
	});

	it("detects 'boy vocals'", () => {
		expectGender("90s boy vocals pop", "male");
	});

	it("detects 'boy vocal' (singular)", () => {
		expectGender("high boy vocal tenor", "male");
	});
});

describe("case-insensitivity", () => {
	it("detects 'FEMALE' uppercase", () => {
		expectGender("FEMALE VOCALS ONLY", "female");
	});

	it("detects 'Female' title case", () => {
		expectGender("Female Singer playlist", "female");
	});

	it("detects 'MALE' uppercase", () => {
		expectGender("MALE VOCALIST ROCK", "male");
	});

	it("detects 'Male-Fronted' mixed case", () => {
		expectGender("Male-Fronted metal bands", "male");
	});
});

describe("ambiguous (both signals)", () => {
	it("returns ambiguous when both 'female' and 'male' appear", () => {
		expectGender("female and male vocals", "ambiguous");
	});

	it("returns ambiguous for 'women and men'", () => {
		expectGender("songs by both women and men", "ambiguous");
	});

	it("returns ambiguous for 'girl and boy'", () => {
		expectGender("girl and boy duet", "ambiguous");
	});

	it("returns ambiguous for 'female-fronted' + 'man'", () => {
		expectGender("female-fronted bands featuring a man", "ambiguous");
	});

	it("returns ambiguous for duet description", () => {
		expectGender("duets with a woman and a man singing together", "ambiguous");
	});
});

describe("word-boundary rules", () => {
	// "woman" must not match inside "womanhood" — 'h' follows 'n', no word boundary.
	it("does not match 'woman' inside 'womanhood'", () => {
		expectGender("themes about womanhood", "none");
	});

	// "man" must not match inside "woman"
	it("does not match 'man' inside 'woman'", () => {
		expectGender("songs with a woman lead", "female");
	});

	it("does not match 'man' inside 'romance'", () => {
		expectGender("romantic songs about romance", "none");
	});

	it("does not match 'man' inside 'mantle'", () => {
		expectGender("wearing a mantle of sadness", "none");
	});

	it("does not match 'boy' inside 'boycott'", () => {
		expectGender("songs about boycotts", "none");
	});

	it("does not match 'girl' inside 'girlie' (no word boundary before 'i')", () => {
		// \bgirl\b requires a word boundary after 'l'. In "girlie", 'i' follows 'l'
		// (a word char), so no boundary exists — correctly returns none.
		expectGender("girlie pop vibes", "none");
	});

	it("does not match 'men' inside 'women' alone — resolves as female", () => {
		// "women" contains the substring "men" but \bmen\b requires a word boundary before 'm'.
		// In "women", 'w' precedes 'o' precedes 'm' — \bmen\b has no word boundary before 'm'.
		expectGender("songs sung by women", "female");
	});

	it("does not match 'male' inside 'female' alone — resolves as female", () => {
		// "female" ends with "male" but \bmale\b requires boundary before 'm'.
		// In "female", 'e' (word char) precedes 'm', so no word boundary there.
		expectGender("female vocalist", "female");
	});
});

describe("no hidden inference", () => {
	it("does not infer from a name like 'Roman' (contains 'man' sub-string)", () => {
		expectGender("playlist inspired by Roman Polanski films", "none");
	});

	it("does not infer from 'Femme Fatale' — 'femme' is not in the keyword list", () => {
		expectGender("Femme Fatale vibes", "none");
	});

	it("does not infer from 'Boygenius' — 'boy' is a prefix, not word-bounded alone", () => {
		// "Boygenius" — \bboys?\b requires boundary after 'y'. 'g' is a word char so no boundary.
		expectGender("Boygenius album playlist", "none");
	});

	it("does not infer from 'Mankind' — 'man' is followed by word char 'k'", () => {
		expectGender("songs about mankind", "none");
	});

	it("does not infer from 'Menopause' — 'men' is followed by word char 'o'", () => {
		expectGender("songs about menopause", "none");
	});

	it("does not infer from 'Girls Aloud' (artist name) — 'girls' IS in the keyword list, accepted match", () => {
		// Per spec: word-boundary matching means genuine keyword matches are acceptable.
		// "girls" in "Girls Aloud" is a real keyword so detection is correct (female).
		expectGender("Girls Aloud greatest hits", "female");
	});

	// Hyphenated franchise names: the hyphen acts as a non-word character, so the
	// segment after it starts a new word boundary. "X-Men" → \bmen\b matches "Men";
	// "Spider-Man" → \bman\b matches "Man". This is intentional and mirrors the
	// "Girls Aloud" precedent — the keyword genuinely appears word-bounded.
	it("matches 'men' in 'X-Men soundtrack' via hyphen word boundary (intentional)", () => {
		expectGender("X-Men soundtrack", "male");
	});

	it("matches 'man' in 'Spider-Man playlist' via hyphen word boundary (intentional)", () => {
		expectGender("Spider-Man playlist", "male");
	});
});

describe("edge cases", () => {
	it("handles text with only whitespace", () => {
		expectGender("   ", "none");
	});

	it("handles newlines in intent text", () => {
		expectGender("jazz vibes\nfemale vocals\nrelaxing", "female");
	});

	it("handles punctuation adjacent to keyword", () => {
		expectGender("playlist: female, relaxing", "female");
	});

	it("handles hyphen in phrase 'female-fronted'", () => {
		expectGender("female-fronted rock band", "female");
	});

	it("handles keyword at start of string", () => {
		expectGender("male vocals jazz", "male");
	});

	it("handles keyword at end of string", () => {
		expectGender("jazz with female", "female");
	});
});
