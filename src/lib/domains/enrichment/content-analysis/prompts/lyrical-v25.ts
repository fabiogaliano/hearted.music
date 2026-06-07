import { lyricalV17 } from "./lyrical-v17";
import type { PromptVersion } from "./types";

// v25 = lyrical-v17.ts + ONE register edit (Phase-4 iteration H7). Branches from v17.
//
// Hypothesis: the strongest register lever in the research is FEW-SHOT VOICE SAMPLES, not rules.
// Gemini's own prompt-design docs say to "always include few-shot examples… they regulate the phrasing
// and general patterning of responses," and humanizing-LLM research finds "even 2–5 samples of a
// voice produce dramatically better results than instructions." v17 injects two FULL gold reads via
// {example}, but those are whole structured objects competing against a ~20-rule wall; the prompt never
// shows the SENTENCE-LEVEL register move in isolation. v21 tried to re-weight the examples with one
// meta-sentence and failed. This edit adds a compact block of four INVENTED friend-voice sentences right
// under the persona line (where Gemini weights persona most), demonstrating the direct, inside-the-song,
// second-person move — positive only, no "Wrong:" forms to copy, and guarded ("borrow the shape, never
// the scene") the way v17 already guards the worked examples, to keep the model from lifting them as
// content. Measured FREE via the tier1 antithesis rule; the winner's candidates get a grounding spot-
// check since invented sentences carry a (small) lift risk. Everything else byte-identical to v17.
// ACTIVE stays v13. Run at temperature 0.3. See claudedocs/08 (H7).

const PERSONA_TAIL = `Your job is the part underneath, the thing they haven't caught yet.`;

const VOICE_BLOCK = `Your job is the part underneath, the thing they haven't caught yet.

Here is the voice, in a few lines, so you can hear the register before you write. Borrow the shape, never the scene — these belong to no song here:
  • She drives past his street one more time and calls it closure.
  • The beat struts in like it owns the block, and you fall in step.
  • He swears he's fine on the chorus and you don't buy it for a second.
  • It sounds like summer until you catch what she's actually saying.
Each line says what happens, or what it does to you, straight out and in the order it lands. No setup, no verdict on the song from the outside. That is the whole voice.`;

const template = lyricalV17.template.replace(PERSONA_TAIL, VOICE_BLOCK);
if (template === lyricalV17.template) {
	throw new Error(
		"lyrical-v25: persona anchor not found in v17 template — edit is a no-op",
	);
}

export const lyricalV25: PromptVersion = {
	version: "25",
	kind: "lyrical",
	notes:
		"v17 + ONE register edit (Phase-4 H7): adds a compact block of four invented friend-voice sentences under the persona line, demonstrating the direct inside-the-song second-person move at the SENTENCE level (the strongest register lever per Gemini's few-shot guidance and humanizing-LLM research). Positive only — no 'Wrong:' forms — and guarded ('borrow the shape, never the scene') against being lifted as content. Measured free via the tier1 antithesis rule, with a grounding spot-check on the winner. Everything else identical to v17. Branches from v17. Registered but NOT active (prod ships v13). Run at temperature 0.3.",
	template,
};
