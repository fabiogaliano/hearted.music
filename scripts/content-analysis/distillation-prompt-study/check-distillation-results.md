# check-distillation — first full run (2026-06-06)

Snapshot of the first full live run of `check-distillation.ts`. Static capture, not auto-generated.

## Method

For each gold lyrics doc:
1. Run the real distiller — `ensureAnnotationDistillations(doc.sections)` → google-vertex Flash-Lite, cached on `content_hash`.
2. Walk annotations, dedup by normalized text, recover every `(raw annotation, distilled text)` pair.
3. One live Opus judge call per pair (via the `claude` CLI): *is every claim in the distilled text supported by the raw annotation?* → `{ faithful, unsupported_claims }`.

Golds expected `faithful: true`. Two handcrafted negatives (real gold distillations with an unsupported fact spliced in) expected `faithful: false`. Exit non-zero on any mismatch.

Config: all 9 golds + 2 negatives, concurrency 2, judge = Opus, distiller = Flash-Lite via Vertex.

## Result

**70 / 78 as expected. Opus cost ~$2.23.** Both negatives caught. 8 golds flagged.

```
  [ok] gold:as-it-was: faithful            (x7)
  [WRONG] gold:beautiful-things: FLAGGED   ("girlfriend" — RAW only says "a person that you're in love with")
  [ok] gold:beautiful-things: faithful     (x4)
  [ok] gold:blinding-lights: faithful      (x10)
  [ok] gold:drivers-license: faithful      (x11)
  [WRONG] gold:drivers-license: FLAGGED    ("driving through the suburbs")
  [WRONG] gold:drivers-license: FLAGGED    ("seeing the subject's face in white cars")
  [ok] gold:dtmf: faithful                 (x5)
  [ok] gold:motion-sickness: faithful      (x8)
  [ok] gold:not-like-us: faithful          (x18)
  [WRONG] gold:not-like-us: FLAGGED        ("the woman was convicted of assaulting him" — RAW reverses this)
  [WRONG] gold:not-like-us: FLAGGED        ("propped up on other 'niggas'" — RAW says "the broader hip-hop sphere")
  [ok] gold:pink-pony-club: faithful       (x4)
  [WRONG] gold:pink-pony-club: FLAGGED     ("visions of herself in L.A.")
  [WRONG] gold:pink-pony-club: FLAGGED     ("definitively spoken by a mother / lamenting" — RAW hedges "could also be")
  [WRONG] gold:pink-pony-club: FLAGGED     ("every night")
  [ok] negative:swap-bio:blinding-lights: FLAGGED   (Reykjavik 2009 — correct)
  [ok] negative:append-chart:as-it-was: FLAGGED     (Norway #1 — correct)
```

(51 annotations across the 9 docs had no distillation and were skipped — distiller fell back to raw.)

## Flag analysis

The judge in this run is **annotation-only**. But the distiller is fed `(annotation, lyricLine)` and grounds claims on the lyric too — so 6 of 8 flags are the distilled text restating the lyric line, which the annotation-only judge wrongly calls "unsupported."

**6 false-positives (distilled claim is literally in the lyric line):**

| song | flagged claim | lyric line it came from |
| --- | --- | --- |
| beautiful-things | "girlfriend" | "I found a **girl** my parents love" |
| drivers-license | "driving through the suburbs" | "today, I drove through the **suburbs**" |
| drivers-license | "face in white cars" | "I still see your face in the **white cars**" |
| not-like-us | "niggas" (vs RAW "broader hip-hop sphere") | lyric word |
| pink-pony-club | "visions of herself in L.A." | "the crazy **visions of me in L.A.**" |
| pink-pony-club | "every night" | "**Every night**'s another reason why I left it all" |

**2 genuine-ish slips (not lyric-grounded):**

- **pink-pony-club** — distiller states the line is *definitively* the mother "lamenting"; RAW only hedges ("could **also** be decrying"). Certainty inflation. Real faithfulness slip.
- **not-like-us** — pronoun flip on the Baka conviction; but RAW prose is grammatically broken ("she refused to testify and was instead convicted of assaulting her"), so the source itself is ambiguous. Likely garbage-in, not distiller fault.

## Root cause

The distiller prompt (`prompts/distill.ts`) is internally in tension: it hands the model the lyric, asks it to "say what the line means," and *also* says "never add a fact not in the annotation." Lyric-grounding is the natural result. The annotation-only judge can't tell lyric-grounded (fine) from invented (bad).

## Next step (proposed, not yet applied)

Make the judge **lyric-aware**: `supported = in the annotation OR a plain reading of the lyric line`; flag only facts grounded in neither. Clears the 6 false-positives, negatives still fail (their facts are in neither input), and any residual flag is a real finding (likely the pink-pony hedge-drop).
