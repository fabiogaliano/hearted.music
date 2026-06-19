import { describe, expect, it } from "vitest";
import { cleanLyrics, detectLanguage } from "../detector";

// Fixtures are original sentences written for this test, NOT song lyrics — the
// detector only needs representative prose of each language, and using real
// lyrics would put copyrighted text in the repo.
const EN =
	"The morning light came slowly through the window and I knew that today would be different from all the days that came before it.";
const ES =
	"La luz de la mañana entró despacio por la ventana y supe que hoy sería diferente de todos los días que vinieron antes.";
const FR =
	"La lumière du matin est entrée lentement par la fenêtre et j'ai su que ce jour serait différent de tous les jours précédents.";
const DE =
	"Das Morgenlicht kam langsam durch das Fenster und ich wusste, dass dieser Tag anders sein würde als alle Tage zuvor.";

describe("cleanLyrics", () => {
	it("strips bracketed and parenthetical section markers", () => {
		const out = cleanLyrics(
			"[Chorus]\nhello there friend\n(x2)\nhow are you today",
		);
		expect(out).toBe("hello there friend how are you today");
	});

	it("collapses whitespace and caps length", () => {
		const out = cleanLyrics("a\n\n\n  b   c\n");
		expect(out).toBe("a b c");
	});
});

describe("detectLanguage", () => {
	it("detects English", async () => {
		const r = await detectLanguage(EN);
		expect(r.language).toBe("en");
		expect(r.confidence).toBeGreaterThan(0.3);
		expect(r.secondary).toBeNull();
	});

	it("detects Spanish", async () => {
		expect((await detectLanguage(ES)).language).toBe("es");
	});

	it("detects French", async () => {
		expect((await detectLanguage(FR)).language).toBe("fr");
	});

	it("detects German", async () => {
		expect((await detectLanguage(DE)).language).toBe("de");
	});

	it("returns null language for text below the minimum length", async () => {
		const r = await detectLanguage("hola");
		expect(r.language).toBeNull();
		expect(r.secondary).toBeNull();
	});

	it("flags a strong secondary language for clearly bilingual text", async () => {
		// Two languages each filling ~half the song, long enough to span several
		// chunks per language (mirrors a real bilingual track).
		const half = (s: string) => Array(5).fill(s).join(" ");
		const r = await detectLanguage(`${half(EN)} ${half(FR)}`);
		expect(r.language).not.toBeNull();
		expect([r.language, r.secondary].sort()).toEqual(["en", "fr"]);
	});

	it("does not flag a secondary language for monolingual text", async () => {
		const r = await detectLanguage(Array(5).fill(EN).join(" "));
		expect(r.secondary).toBeNull();
	});
});
