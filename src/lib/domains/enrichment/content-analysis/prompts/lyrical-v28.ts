import { lyricalV17 } from "./lyrical-v17";
import type { PromptVersion } from "./types";

// v28 = lyrical-v17.ts + TWO register edits, the synthesis of the Phase-4 H5–H9 smoke winners (H10).
// Branches from v17. The free smoke (Flash n=3 × 9 golds, the tier1 cross-sentence antithesis rule)
// ranked the five single-lever variants; the two that lowered BOTH the pivot rate and total-high while
// staying clean on book-report were orthogonal:
//   • v24 (copula-displacement): build the read out of motion, reserve "is/are" for plain fact — attacks
//     the pivot's grammatical scaffolding. Best free score (0.23/c). Hand-read: genuinely direct on
//     protagonist-driven songs (drivers-license, DtMF, Motion Sickness).
//   • v25 (sentence-level micro-exemplars): a compact friend-voice sample block under the persona —
//     transferred the second-person register holistically (As It Was read near-gold).
// This fuses both. Honest scope: the smoke gaps are within noise (n~30) and NEITHER lever eliminates the
// pivot — it persists on collective/argument songs (Not Like Us, Pink Pony Club) where there is no single
// protagonist to follow, rerouting into "It defines/weaponizes…" essayism or a take-closing "not just X;
// it is Y". v28 is the best PROMPT we can ship for register; full elimination still needs the tier1
// regenerate-on-hit gate (already built) on the residual pivot. Measured FREE via runAllRules; a paid
// pairwise vs gold is the real readiness test. Both edits guarded — a missing anchor throws rather than
// silently shipping a clone. ACTIVE stays v13. Run at temperature 0.3. See claudedocs/08 (H10).

const PERSONA_TAIL = `Your job is the part underneath, the thing they haven't caught yet.`;
const VOICE_BLOCK = `Your job is the part underneath, the thing they haven't caught yet.

Here is the voice, in a few lines, so you can hear the register before you write. Borrow the shape, never the scene — these belong to no song here:
  • She drives past his street one more time and calls it closure.
  • The beat struts in like it owns the block, and you fall in step.
  • He swears he's fine on the chorus and you don't buy it for a second.
  • It sounds like summer until you catch what she's actually saying.
Each line says what happens, or what it does to you, straight out and in the order it lands. No setup, no verdict on the song from the outside. That is the whole voice.`;

const ANTI_PIVOT_LINE = `Say what something is. Don't say what it "isn't" and then pivot to what it is. A plain subordinate contrast inside a sentence is not that move and is fine: "the door stays shut, not slammed."`;
const COPULA_DISPLACEMENT_LINE = `Build the read out of motion. Reach for verbs of action — what the song and its people do, push, chase, refuse — and let "is" and "are" carry plain fact only, not the verdict about what the song "really means." A read that moves stays close to the song and sounds like a person; a read that keeps defining sounds like an essay.`;

let template = lyricalV17.template.replace(PERSONA_TAIL, VOICE_BLOCK);
if (template === lyricalV17.template) {
	throw new Error(
		"lyrical-v28: persona anchor not found in v17 template — voice-block edit is a no-op",
	);
}
const afterVoice = template;
template = template.replace(ANTI_PIVOT_LINE, COPULA_DISPLACEMENT_LINE);
if (template === afterVoice) {
	throw new Error(
		"lyrical-v28: anti-pivot anchor not found — copula-displacement edit is a no-op",
	);
}

export const lyricalV28: PromptVersion = {
	version: "28",
	kind: "lyrical",
	notes:
		"v17 + TWO register edits — the synthesis of the Phase-4 smoke winners (H10): v24's copula-displacement line (build the read out of motion, reserve is/are for plain fact) fused with v25's sentence-level friend-voice micro-exemplar block under the persona. Banks both register gains (best free pivot score + holistic second-person voice transfer). Honest scope: smoke gaps are within noise and neither lever eliminates the pivot — it persists on collective/argument songs (Not Like Us, Pink Pony Club); full elimination still needs the tier1 regenerate-on-hit gate. Measured free via runAllRules; paired pairwise vs gold is the real readiness test. Both edits guarded against no-op. Branches from v17. Registered but NOT active (prod ships v13). Run at temperature 0.3.",
	template,
};
