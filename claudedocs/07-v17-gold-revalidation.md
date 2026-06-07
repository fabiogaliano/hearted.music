# v17 gold re-validation (2026-06-06)

Closes the open item from `03-voice-audit-v17-loop.md` Part A: *"read each gold and confirm it
would satisfy every instruction you wrote. If a gold violates an instruction, the instruction is
wrong (golds are truth) — soften it."* The v17 header comment claimed the caps were re-validated,
but no documented pass existed. This is that pass.

**Validated against:** `prompts/lyrical-v17.ts` as of the unstaged 2026-06-06 revision (working
tree, not yet committed).

**Golds checked (9):** pink-pony-club, dtmf, blinding-lights, not-like-us, no-sex-for-ben,
motion-sickness, drivers-license, beautiful-things, as-it-was.

**Method:** every checkable v17 instruction extracted into a checklist (global "HOW TO WRITE" +
"INTERPRET" + per-field specs + the closing banned-vocabulary list), then each gold read field by
field against it. A flag means the gold breaks the rule as written; because golds are truth, the
flag is resolved by softening the rule, not the gold.

---

## Per-gold verdict

| gold | caps | mechanical bans | flags raised |
| --- | --- | --- | --- |
| pink-pony-club | clean (lens 6w, image 10w = journey) | clean | — |
| dtmf | clean (lens 10w flex, image 8w) | "in the song" self-ref (#5) | F-cap (#1), self-ref (#5) |
| blinding-lights | clean (lens 7w relative-clause flex, image 8w) | clean | F-cap (#1) |
| not-like-us | clean (lens 6w, image 5w) | clean | image-is-sentence (#3), line-reuse (#4) |
| no-sex-for-ben | clean (texture 3-sentence flex, contradiction null) | clean | comma-coordination (#6) |
| motion-sickness | clean | clean | comma-coordination (#6) |
| drivers-license | clean | clean | comma-coordination (#6), backstory-tense (#7) |
| beautiful-things | clean | clean | backstory-tense (#7) |
| as-it-was | image 9w (heard line, **over cap**) | clean | image-cap (#2), F-cap (#1), line-reuse (#4) |

No gold violated any **cap that the header already documented**. The over-cap and over-form cases
(dtmf 10-word lens, pink-pony 10-word journey-image, blinding 7-word `X that turns out to be Y`,
no-sex-for-ben 3-sentence texture) all fall inside the flexes the header already wrote in. The new
findings are all **non-cap** rules.

---

## Findings → softenings applied

### Genuine gold-violations (rule softened, golds are truth)

**#1 — Fragment cap was too strict.** Rule said *"a true fragment … is rare: at most one in a
field."* Broken by:
- blinding-lights "The Need": *"Blinded by the lights. Drowning in the night."* — two true fragments.
- dtmf "The Ache": *"San Juan sunsets he watched without a camera. A girl he wants to go back to,
  things he never said, photos he never took."* — two noun-phrase fragments.
- as-it-was take close: *"As it was. As it was."* — two quoted-lyric fragments.

Author's reasoning (confirmed): fragments should be avoided most of the time but sometimes land
nicely — the cap stays as the default. as-it-was's "As it was. As it was." is a direct quote of the
refrain, a play on the song itself, so quoted-lyric fragments don't count. dtmf's "The Ache" is not
two staccato phrases for punch — the noun-phrase run *tells the story* and simply reads nicer than
full sentences would.

Softened (in two places — the global writing rule and the arc-scene spec, which also said
"complete sentences"): the "rare / at most one in a field" cap is kept as the default (most often
none at all); a deliberate stack of two or three is allowed only when it genuinely lands, either as
a clipped beat or a quick montage that tells the story faster than full sentences; any longer
passage stays mostly whole sentences (so a single-fragment short field like blinding-lights' or
drivers-license's texture stays fine, just as the old "at most one" allowed); a quoted lyric that
happens to be a fragment, a play on the song's own words, doesn't count.

**#2 — Image over-target exception was too narrow.** Rule allowed >8 words *only* for "a single
felt span — a journey from one place or state to another." Broken by as-it-was's 9-word image
*"come on, harry, we wanna say goodnight to you"* — a bare heard line, not a journey. v17 elsewhere
says "a bare, well-chosen heard line is often the strongest image," so the cap exception now admits
a bare heard line alongside a felt span.

Author's reasoning (confirmed): the line earns its length because it *tells the story* — someone is
calling him and he is not answering — which is exactly the image field's job ("carry the emotional
fact, not just the place"), not padding. No hard word ceiling was added on the heard-line case: the
"is itself the strongest image" test is self-limiting (it stops a long mid-verse line from being
quoted just because it was heard).

**#3 — "A phrase, not a sentence" collided with the heard-line blessing.** not-like-us's image
*"psst. i see dead people"* is grammatically a sentence (the song's quoted opening line). Softened:
the phrase-not-sentence rule now exempts a bare heard line you quote, which may itself be a full
sentence.

Author's reasoning (confirmed): it's a direct quote of the song's cold-open, particularly fitting
for a diss track where the opening taunt sets the whole thing in motion. The rule was only ever
meant to stop the model from composing its *own* little sentences as images; quoting the song's own
words is exempt regardless of their grammar (the v17 phrase "a sentence of your own making" draws
exactly that line).

**#4 — `lines` no-repeat collided with "end the take on the song's words" (I4/TK3).** Internal v17
contradiction surfaced by the golds:
- as-it-was: *"I don't wanna talk about the way that it was"* appears verbatim in both take and lines.
- not-like-us: *"you not a colleague, you a fuckin' colonizer"* lands the take and is also a line.
- pink-pony: *"God, what have you done"* recurs across take, an arc scene, and lines.

Author's reasoning (confirmed): lean (1) — it's fine for a key line to appear in both, since these
are genuinely key lines so it's normal they also surface in `lines` — but with a dose of (2): the
overlap should be avoided by default and reached for only when the song demands it. Not a big
problem when it happens, but not a habit.

Softened (tightened from the first pass, which read as a standing allowance): `lines` prefers lines
no other field has already spent, and re-quoting a line the take or an arc lands on is to be
avoided, not habitual. The narrow exception is the song's truly signature line — so central it has
to appear — which may recur as the exact pull-quote, but only when the song genuinely demands it.

**#7 — Take present-tense is violated by backstory.** Most golds open the take in past tense
("She left the Midwest," "She got her license," "Las Vegas was supposed to be freedom"). Softened:
the take is mostly present tense, with past tense allowed for genuine backstory.

Author's reasoning (confirmed): tense should track the song's *own timeline*, song by song. drivers-
license is about the now (having the license, driving around) so that runs present, but the
promises were made earlier and she got the license without him there — genuinely past, so the take
uses past for those. Deliberately *not* tightened to a rigid "land back in present": a song whose
timeline is mixed should read mixed. Present is the home register; past is for what the song itself
places in the past.

### Preventive clarifications (gold does not strictly break the literal wording, but it risks a
false positive on a literal-minded reader)

**#5 — Self-reference ban.** v17 bans "this song," "the track," "the album," etc. — it never lists
"the song." dtmf says *"right there in the song" / "inside the song."* Reading the lyrics
(`exemplars/lyrics/dtmf.json`) confirms this is a real diegetic moment, not a lazy frame: Verso 2's
refrain **cuts off mid-word** ("Debí tirar más f—", the "fotos" never finishes), and the song
breaks into a spoken Interludio where Bad Bunny gathers everyone for the photo ("vamo' pa' la foto,
vengan pa'cá / Métase to'l mundo, to'l corillo" — let's take the photo, come here, everyone get
in). The whole song is "I should have taken more photos of when I had you," and the music literally
stops so he can take one inside the recording. The song's structure *is* the content.

**Decision: keep the carve-out.** Naming the recording is allowed when its own gesture is the event
(the music cutting out, a beat switch, a sample speaking). It demands an actual structural event, so
it won't invite "in the song" as a habit, while it stops a model that has internalized "never name
the song" from flattening the single most important beat of this read.

**#6 — "Don't chain them with commas."** Golds use `, and` / `, but` coordination (motion-sickness
contradiction: *"She can hardly feel anything anymore, and the one thing she can still feel is the
pull back toward him."*; drivers-license: *"He has moved on, and she is still driving the route to
his door."*; no-sex-for-ben take: *"Everyone agreed on it, and they are having a great time telling
him so."*). A comma + coordinating conjunction is not a comma splice.

Author flagged a real worry: is `, and` an AI tell? Checked against Wikipedia's "Signs of AI
writing" essay. It does **not** flag coordinating conjunctions or compound sentences. The
structural tells it *does* name — the rule of three ("adjective, adjective, adjective"), negative
parallelism ("not only … but also" / "it's not just X, it's Y"), and em-dash overuse — are already
banned in v17 (the closing "no rule-of-three list as a crutch"; the "say what something *is*, don't
say what it *isn't* and pivot" rule = the negative-parallelism tell; "no mirrored 'X is the Y'
parallelism"; and the trailing-em-dash ban). And the gold contradictions read *more* naturally with
`, and` — the hinge holds the two sides in tension; splitting them into two flat sentences loses the
irony the contradiction field exists to carry.

Softened, but reworded so it is **not** a blanket allowance (the first pass quietly weakened the
full-stop discipline that is good anti-AI hygiene): lean hard on full sentences (two ideas is
usually two sentences), never splice two clauses with a bare comma, and a comma before and/but/so is
fine for two thoughts that truly belong in one breath — not as a habit that runs everything
together.

---

## Examined and left unchanged (so the next pass doesn't re-flag them)

- **Lens concrete-Y (L3) vs as-it-was "silence as the grief he allows."** "grief" is a feeling-noun,
  which L3 nominally bans as Y. Left as-is: the lens does not *rename a mood* (silence is not a
  mood), it makes a claim — his silence *is* the only grieving he permits. L3's own test ("if Y only
  renames the feeling, you have written the mood") is not tripped. Compliant.
- **Comma + noun + `-ing` (nominative absolute).** pink-pony "Santa Monica calling her";
  beautiful-things texture "the dynamics swinging as wildly as the fear underneath them." v17's rule
  is literally *"a comma followed by a word ending in -ing,"* and in both the word after the comma is
  a noun, not the participle — so the rule correctly does not fire. This is the same literalness the
  header's "false alarm" note relied on for the image; keep the rule literal.
- **"probably" (drivers) / "might make her scream" (pink-pony).** Lyric-grounded (the words are in
  the song), not the model hedging its own read; P5's banned list doesn't include them. Fine.
- **Rule-of-three lists.** blinding "No one to answer to, no one around to judge, the whole city
  burning"; not-like-us's charge list; dtmf's genre roll-call. P6 bans rule-of-three *"as a crutch"*;
  these earn their place through specificity (S1). The "as a crutch" qualifier already protects them.

---

## Conclusion

After the seven edits above, v17 is a prompt all nine golds could have been written under: no gold
breaks a rule it leaves standing, and every rule a gold broke has been softened toward the gold.
The remaining open Phase-3 items (the 8-judge scorecard fusion, the captured v17 baseline) are
unaffected by this pass.
