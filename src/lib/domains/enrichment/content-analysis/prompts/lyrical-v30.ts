import { lyricalV29, POSITIVE_MENU_LINE } from "./lyrical-v29";
import type { PromptVersion } from "./types";

// v30 = v29 (positive-menu generation) + the commenter's XML wrapper applied to the GENERATION guidance
// (Phase-4 H13 — "mix the two concepts," user-requested). The source idea's commenter (Sable-Keech)
// reported the Direct Assertion instruction "works even better enclosed in
// <master_prompt_override_style_guide>…</…> XML tags"; the rewrite-pass direct-assertion mode already
// uses that wrapper. This variant tries the SAME wrapper on the GENERATION side, around v29's
// positive-menu anti-pivot block, to test whether the XML delimiter makes Gemini honor the directive
// more reliably at generation time (Gemini's own prompting guidance favors clear structural delimiters).
//
// It is the v29 generation concept × the XML-style-guide concept. Built FOR A LATER ROUND per the user
// — NOT generated or judged in the current pass (v29's positive-menu already free-smoked ≈v17 on the
// pivot rate, so the open question this variant probes is purely whether the XML delimiter changes
// adherence). Branches from v29; only the wrapper differs. Registered but NOT active (prod ships v17).
// Run at temperature 0.3.

const WRAPPED_MENU = `<master_prompt_override_style_guide>\n${POSITIVE_MENU_LINE}\n</master_prompt_override_style_guide>`;

const template = lyricalV29.template.replace(POSITIVE_MENU_LINE, WRAPPED_MENU);
if (template === lyricalV29.template) {
	throw new Error(
		"lyrical-v30: positive-menu anchor not found in v29 template — edit is a no-op",
	);
}

export const lyricalV30: PromptVersion = {
	version: "30",
	kind: "lyrical",
	notes:
		"v29 (positive-menu generation) + the XML <master_prompt_override_style_guide> wrapper applied to the GENERATION guidance (Phase-4 H13, user-requested 'mix the two concepts'): the commenter's tag idea, used on the rewrite block by direct-assertion mode, tried on the generation side around v29's anti-pivot menu. Probes whether the XML delimiter improves Gemini's adherence at generation. Branches from v29; only the wrapper differs. Built for a LATER round — not generated/judged in the current pass. Registered but NOT active (prod ships v17). Run at temperature 0.3.",
	template,
};
