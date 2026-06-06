import type { ConceptRead } from "@/lib/domains/enrichment/content-analysis/concept-schema";

// The lens is the thesis of the read; everything else is evidence for it
// (concept-lens-vocabulary.md §0). This judge is where Analyze -> Identify -> Violate
// becomes a grading rule: it has to catch the category-typical slop the prompt steers
// away from, and the SURFACE-abuse inverse (a deep song lazily tagged thin).
export function lensCoherencePrompt(a: ConceptRead): string {
	const arc = a.arc
		.map((beat) => `  - [${beat.label} — ${beat.mood}] ${beat.scene}`)
		.join("\n");
	const lines = a.lines.map((l) => `  - "${l.line}"`).join("\n");

	return `You are auditing whether a song read holds together around its LENS.

The lens is the read's thesis: a one-line claim about what the song is really doing underneath the surface. It is NOT a mood, a genre, or a theme tag — it is an argument the rest of the read must earn. It takes one of three forms: "X as Y" / "X of Y" / "X with Y" (critical), "X into Y" (transformational), or "Verb-ing the X" (narrative).

Judge two things together:

1. COHERENCE — does the \`take\` actually read THROUGH the lens? A coherent read argues the lens; the image, take, and contradiction are all evidence for that one claim. An incoherent read wears the lens as decoration: the lens says one thing and the take is about something else, or the lens could be swapped for any other phrase without changing a word of the take.

2. SURFACE ABUSE (the inverse failure) — a thin, descriptive lens (one that just names what the song DOES — "moving for the joy of moving", "the hook as the whole thesis") is only valid when the song is genuinely thin. If the lens is descriptive/surface-level BUT the take or contradiction reveal a real buried claim (a genuine subtext the lens ignores), the read was lazy: it dodged the work a deeper lens would have named. Flag that.

Also fail the lens if it is category-typical slop the lens is supposed to violate:
- an abstract summary noun doing the work ("a meditation on loss", "a journey of self-discovery", "a celebration of...", "a declaration of...", "X as catharsis/testament/tapestry")
- a bare mood word ("melancholy", "euphoric", "bittersweet")
- a bare theme tag with no connector and no gerund ("heartbreak", "community defense")
- a restatement of the two-word \`tension\` field rather than a claim

Longer is not better. Do not reward filler.

LENS: ${a.lens}
TENSION: ${a.tension}
IMAGE: ${a.image}
TAKE: ${a.take}
CONTRADICTION: ${a.contradiction ?? "(none)"}
ARC:
${arc}
LINES:
${lines}

Work in this order — reason first, decide last:
- rationale: 1–2 short bullets (under 20 words each). Test the take against the lens, and check for buried depth, before judging.
- problems: when not coherent, name the issue(s) — quote the decorative lens, the depth a surface lens ignored, or the slop phrase. Empty array if coherent.
- coherent: decide this LAST. true if the take genuinely argues the lens AND (if the lens is descriptive/surface) the song really is thin AND the lens is a defensible claim, not slop. False otherwise.`;
}
