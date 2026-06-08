// Flash-rewrites-Flash post-generation rewrite pass. Doc-08 (Round 2) converged on the finding
// that the essayistic register CANNOT be prompted away at generation — prohibition, demonstration,
// and removal all leave the tells in (the model routes around banned strings) — and that 0% of v17
// candidates are fully tier1-HIGH-clean, so you cannot resample to clean either. The dominant tell
// is participial-closure (~3.4/read), not the antithesis pivot that READS as most evident.
//
// The lever that IS reliable is a second, surgical pass over the FINISHED read: hand the model the
// exact spans the deterministic checker flagged and ask it to recast only those constructions,
// preserving every grounded claim. A rewrite is a constrained transformation, not free generation —
// the model is not inventing, so it does not fall back into its essayistic default the way it does
// when writing from scratch. Removal is verifiable for FREE with the same tier1 rules.
//
// Invariants are pinned in code, not trusted to the model: the lens, tension, and the verbatim
// lyric `lines` are forced back from the original read; only the prose fields (image, take,
// contradiction, arc scenes, texture) can change, and a null contradiction/texture stays null so
// the pass can never manufacture one. This bounds content drift to the sentences that were flagged.

import { Result } from "better-result";
import {
	SongReadSchema,
	type SongRead,
} from "@/lib/domains/enrichment/content-analysis/read-schema";
import type { LlmService } from "@/lib/integrations/llm/service";
import { runAllRules } from "../tier1/rules";
import type { RuleHit } from "../types";

// The HIGH-severity register tells a surgical edit can remove without changing what the read
// claims. Kept narrower than "all HIGH rules" on purpose: mood-width/tension-dedup are structural,
// not prose constructions, and the dash/lexical rules are LOW. These six are the wall.
export const TARGET_RULES = new Set([
	"antithesis",
	"participial-closure",
	"self-reference",
	"book-report-opener",
	"academic-register",
	"structural-section",
]);

// One fix recipe per target rule. Only the recipes for rules that actually fired on a given read
// are injected, so the instruction stays focused on the tells present in THIS read rather than
// re-priming the model with the full catalogue (the priming failure mode from H4/v22).
const RECIPES: Record<string, string> = {
	"participial-closure":
		'participial-closure — a comma followed by an "-ing" word tacked onto the end of a sentence ("..., revealing the cost of pride."). Recast the "-ing" as a real finite verb whose subject is the person or thing acting, or end the sentence at the comma and start a fresh one. Never go passive ("the line is drawn"). Example: "She holds the room, drawing a line between us and them." → "She holds the room and draws the line between us and them."',
	antithesis:
		'antithesis — the "X is not Y. It is Z" / "not just X; it is Y" thesis-pivot. Say what it IS, directly, and drop the negated setup entirely. Example: "This is not a diss track. It is testifying." → "It testifies." A plain subordinate contrast inside one sentence is fine and should be left alone ("the door stays shut, not slammed").',
	"self-reference":
		'self-reference — naming the artifact: "this song", "the track", "the album", "the narrator", "the singer", "the speaker", "the vocalist", "the listener". Name what is happening instead, or let the song act as "it". Example: "A beat drives the track." → "A beat drives the whole thing forward."',
	"book-report-opener":
		'book-report-opener — opening a field on a framing verb ("This is", "It is", "This song is", "It\'s not just"). Open on the noun or the image itself. Example: "This is a declaration of war." → "A declaration of war, fought on three fronts."',
	"academic-register":
		'academic-register — critic/essay vocabulary ("explores themes of", "delves into", "commentary on", "juxtaposition", "dichotomy", "catharsis", "disorientation", "existential"). Say the plain-spoken thing a friend would say instead.',
	"structural-section":
		'structural-section — naming the song\'s structural slot ("verse", "chorus", "bridge", "hook", "intro", "outro", "pre-chorus", "refrain") in interpretive prose. Name the emotional moment, not the slot. (Texture may keep a musical term for a sonic motif.)',
};

export interface RewriteResult {
	read: SongRead;
	passes: number;
	hitsBefore: RuleHit[];
	hitsAfter: RuleHit[];
	error?: string;
	tokens: number;
}

function targetHits(read: SongRead): RuleHit[] {
	return runAllRules(read).filter((h) => TARGET_RULES.has(h.rule));
}

// Renders the read field-by-field with the flagged spans inline, so the model sees exactly which
// sentence in which field carries which tell. Unflagged fields are shown too (it needs the whole
// read for coherence) but carry no ⚠ marks — the model is told to copy those through unchanged.
function buildRewritePrompt(read: SongRead, hits: RuleHit[]): string {
	const byField = new Map<string, RuleHit[]>();
	for (const h of hits) {
		const arr = byField.get(h.field) ?? [];
		arr.push(h);
		byField.set(h.field, arr);
	}

	const flagsFor = (field: string): string => {
		const fh = byField.get(field);
		if (!fh) return "";
		return fh
			.map((h) => `\n    ⚠ ${h.rule} — "${h.span}"`)
			.join("");
	};

	const presentRules = [...new Set(hits.map((h) => h.rule))];
	const recipeBlock = presentRules
		.map((r, i) => `${i + 1}. ${RECIPES[r] ?? r}`)
		.join("\n\n");

	// Each arc beat shows label+mood as metadata (pinned in code, the model must keep them) and the
	// scene as a clearly-delimited "scene N:" value. An earlier format ("beat N (label — mood): …")
	// made the model echo "beat 1" back AS the scene — the scene prose must be unmistakably the value.
	const arcBlock = read.arc
		.map(
			(b, i) =>
				`  beat ${i + 1} — keep label "${b.label}", keep mood "${b.mood}"\n  scene ${i + 1}: ${b.scene}${flagsFor(`arc[${i}].scene`)}`,
		)
		.join("\n");

	const linesBlock = read.lines.map((l) => `  - "${l.line}"`).join("\n");

	return `You are editing a finished song read for hearted.music so it sounds like a person, not AI. Keep the voice exactly as it is: a friend who says what they hear, warmly and with certainty.

A deterministic checker flagged specific AI-tell constructions in the prose below (marked ⚠). Your only job is to rewrite the flagged sentences so those constructions are gone, while keeping every grounded claim, named person, place, image, and the exact meaning. Change as little as possible — fix the construction, keep the content. Do NOT add any fact, detail, or claim the read does not already contain. Copy every unflagged sentence through verbatim.

THE TELLS FLAGGED IN THIS READ, AND HOW TO FIX EACH:

${recipeBlock}

After your fix, none of those constructions may remain — and do not introduce a new one (no fresh "-ing" comma clause, no new "not X, it is Y" pivot).

THE READ:

lens (DO NOT CHANGE): ${read.lens}
tension (DO NOT CHANGE): ${read.tension}
image: ${read.image}${flagsFor("image")}
take: ${read.take}${flagsFor("take")}
contradiction: ${read.contradiction ?? "(none)"}${flagsFor("contradiction")}
arc:
${arcBlock}
texture: ${read.texture ?? "(none)"}${flagsFor("texture")}
lines (DO NOT CHANGE — verbatim lyric quotes, return identical):
${linesBlock}

Return the corrected read as structured JSON with the same fields. Keep lens, tension, and every line identical to the input. Return the arc as the same ${read.arc.length} beats in the same order; for each beat keep its label and mood exactly, and return its scene as full prose — rewritten if it was flagged, otherwise copied word-for-word (never return a placeholder like "beat 1"). ${read.contradiction === null ? "Return null for contradiction." : ""} ${read.texture === null ? "Return null for texture." : ""}`.trim();
}

// Field-aware surgical apply: takes the model's rewrite ONLY for fields that were actually flagged
// this pass, and copies every other field through from the fed-in read unchanged. lens/tension/lines
// and all arc labels/moods are always pinned from the original; a null contradiction/texture can
// never be filled. So the model's output can only ever change a flagged sentence — if it paraphrases
// or corrupts an unflagged field (e.g. echoes "beat 1" into a clean scene), that change is discarded.
// Exported for unit testing — this is the content-fidelity invariant the whole pass rests on.
export function applySurgical(
	invariant: SongRead,
	fedIn: SongRead,
	modelOut: SongRead,
	flaggedFields: Set<string>,
): SongRead {
	const pick = (field: string, modelVal: string, fedInVal: string): string =>
		flaggedFields.has(field) && modelVal ? modelVal : fedInVal;

	return {
		lens: invariant.lens,
		tension: invariant.tension,
		lines: invariant.lines,
		image: pick("image", modelOut.image, fedIn.image),
		take: pick("take", modelOut.take, fedIn.take),
		contradiction:
			invariant.contradiction === null
				? null
				: pick(
						"contradiction",
						modelOut.contradiction ?? "",
						fedIn.contradiction ?? "",
					),
		texture:
			invariant.texture === null
				? null
				: pick("texture", modelOut.texture ?? "", fedIn.texture ?? ""),
		arc: invariant.arc.map((b, i) => ({
			label: b.label,
			mood: b.mood,
			scene: pick(
				`arc[${i}].scene`,
				modelOut.arc[i]?.scene ?? "",
				fedIn.arc[i]?.scene ?? b.scene,
			),
		})),
	};
}

// Rewrites a read until the targeted HIGH-register rules clear or the pass budget runs out. Returns
// the cleaned read plus before/after hit lists (full rule set, so callers can see what the pass did
// NOT touch) and the token cost. A pass that hits an LLM error returns the best read so far.
export async function rewriteRead(
	read: SongRead,
	llm: LlmService,
	opts?: { maxPasses?: number; temperature?: number },
): Promise<RewriteResult> {
	const maxPasses = opts?.maxPasses ?? 2;
	const temperature = opts?.temperature ?? 0.2;
	const hitsBefore = runAllRules(read);
	let current = read;
	let passes = 0;
	let tokens = 0;

	for (let p = 0; p < maxPasses; p++) {
		const hits = targetHits(current);
		if (hits.length === 0) break;

		const prompt = buildRewritePrompt(current, hits);
		const gen = await llm.generateObject(prompt, SongReadSchema, {
			temperature,
			maxOutputTokens: 4000,
			functionId: "voice-audit-rewrite-pass",
		});
		if (Result.isError(gen)) {
			return {
				read: current,
				passes,
				hitsBefore,
				hitsAfter: runAllRules(current),
				error: String(gen.error),
				tokens,
			};
		}
		passes++;
		tokens += gen.value.tokens?.total ?? 0;
		const flaggedFields = new Set(hits.map((h) => h.field));
		current = applySurgical(read, current, gen.value.output, flaggedFields);
	}

	return {
		read: current,
		passes,
		hitsBefore,
		hitsAfter: runAllRules(current),
		tokens,
	};
}
