import { lyricalV17 } from "./lyrical-v17";
import type { PromptVersion } from "./types";

// v29 = lyrical-v17.ts + ONE register edit (Phase-4 iteration H11). Branches from v17.
//
// The user-supplied "anti-pivot" idea has two halves; this file tests the GENERATION half. The
// author's own emphasis: "the LLM needs to know the pattern to avoid but MORE IMPORTANTLY it needs to
// be instructed better examples to follow." Every prior generation variant only addressed the
// avoid-half: v20 banned the pivot with concrete Wrong: strings (primed it to 0.56), v23 went
// pure-affirmative with no menu (worst, 0.44), v27 named the category abstractly (safe, ≈v17 0.31).
// None handed the model a POSITIVE MENU of constructions to reach for instead — which is the author's
// real lever. This edit REPLACES v17's one-line anti-pivot caution with that menu (direct definition,
// image/embodiment, cause→effect, situational description, small scene) PLUS the category-level
// caution v27 proved is the safe way to name the move (no spelled-out concrete pivot → no priming),
// PLUS the author's rationale for why the swerve is dead weight ("X is a distraction and associates Y
// with something worse"). The author's literal "Avoid: not, but, instead, just" token-ban is
// deliberately NOT copied — v20 proved a hard ban primes/routes around, and it would also flag the
// legit subordinate contrasts the golds use ("could never be bought, only inherited"); so the v17
// carve-out is kept. The author's ad-copy framing ("Benefit-Oriented, value to the reader") is dropped
// as wrong-register for the house voice. Measured FREE via the tier1 cross-sentence antithesis rule;
// everything else byte-identical to v17. ACTIVE stays v17. Run at temperature 0.3. See claudedocs/08 (H11).

const ANTI_PIVOT_LINE = `Say what something is. Don't say what it "isn't" and then pivot to what it is. A plain subordinate contrast inside a sentence is not that move and is fine: "the door stays shut, not slammed."`;

// Exported so the v30 "mix" variant can wrap exactly this block in the XML style-guide tags without
// duplicating the string (not a barrel — a single named export of the shared anchor).
export const POSITIVE_MENU_LINE = `Say what something is, and build the claim out of what it IS — reach for a plain definition, an image or embodiment, a cause and the effect it sets off, the situation as it stands, or a small scene that shows it. Those are the moves that carry a read. The shape to drop is naming a lesser thing only to swerve off it to the real one ("it isn't X, it's Y," "not just X, but Y"): the dismissed half is dead weight, and bracing your claim against a strawman only borrows a force the claim then has to give back. Let the real thing stand on its own and earn its own weight. A plain subordinate contrast inside one sentence is not that move and is fine: "the door stays shut, not slammed."`;

const template = lyricalV17.template.replace(
	ANTI_PIVOT_LINE,
	POSITIVE_MENU_LINE,
);
if (template === lyricalV17.template) {
	throw new Error(
		"lyrical-v29: anti-pivot anchor not found in v17 template — edit is a no-op",
	);
}

export const lyricalV29: PromptVersion = {
	version: "29",
	kind: "lyrical",
	notes:
		"v17 + ONE register edit (Phase-4 H11): replaces v17's anti-pivot caution with the GENERATION half of the user's anti-pivot idea — a POSITIVE MENU of constructions to reach for (direct definition, image/embodiment, cause→effect, situational description, small scene), the no-prime category-level naming of the move v27 validated, and the author's rationale (the dismissed half is dead weight). Keeps v17's legit subordinate-contrast carve-out; deliberately does NOT copy the author's hard 'not/but/just' token-ban (v20 proved it primes) or the ad-copy 'benefit-oriented' framing (wrong register). Tests the author's claim that better examples-to-follow beat prohibition where v23/v27 did not. Measured free via the tier1 antithesis rule; everything else identical to v17. Branches from v17. Registered but NOT active (prod ships v17). Run at temperature 0.3.",
	template,
};
