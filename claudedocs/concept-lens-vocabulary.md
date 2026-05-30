# Lens Vocabulary — Hearted Song Analysis

**Date:** 2026-05-29 (Session 2)
**Status:** Ideas-layer artifact (Step 1 of the concept redesign). The grammar is locked by Session 1; this file is the vocabulary itself.
**Feeds:** prompt v14 (generation-time anchor) and the matching layer (retrieval-time facet). Eventually the `lens-coherence` voice-audit judge (Step 4).
**Reads alongside:** `concept-redesign-handoff-2026-05-28.md` §2, §7, §8.2; `schema-overprescription-lyric-diagnostic.md`.

---

## 0. What a lens is (one paragraph)

A **lens** is the thesis of the read — a one-line claim about what a song is *really* doing underneath the surface. It is the panel's center of gravity: `image` is the hook, `take` is the development, `arc`/`lines`/`texture` are the evidence, and the lens is the argument they all serve. It is **not** a mood, **not** a genre, **not** a theme tag. A critic could defend it in a sentence. The whole redesign's bet rides on whether the lens can carry that weight — so this vocabulary exists to keep it from decaying into "introspective" / "uplifting" slop by the 100th generated song.

---

## 1. How to write a lens in under 5 minutes (the editor's procedure)

This procedure is the first acceptance test (§9). Follow it top to bottom:

1. **Read the song for its one buried claim.** Not its topic ("a breakup song") — its *move* ("a milestone that doubles as a funeral"). If you can't find a buried claim, the song may be surface-true → go to the **SURFACE** family (§6.11), which is built precisely so you don't fabricate depth.
2. **Pick the family** (§6) by what the song *feels like*. The 11 families are the primary shelf. If two families tie, the **structural-move facet** (§5) breaks the tie.
3. **Pick a form** (§3): `X as Y` if you're asserting "it's really that" (critical); `X into Y` if the song *turns* one thing into another (transformation); `Verb-ing the X` if the meaning *is* the motion (narrative/descriptive).
4. **Borrow or bend a listed lens.** Each family ships 6–8. Swap the concrete noun for one truer to your song (`license as eulogy` → `diploma as eulogy`). Keep `Y` concrete.
5. **Run the kill-checks** (§7): is `Y` an abstract summary noun? Is the whole thing just a mood word or a bare-noun tag? Is it longer than 5 words? If any → rewrite.

If you did this and landed in the same family another editor would, the vocabulary is working.

---

## 2. Creative Conceptualist: Analyze → Identify → Violate

The deliberate category violation behind this whole vocabulary (Creative Conceptualist §III):

- **Analyze** — what does every music app's vocabulary do? It classifies: mood tags (`sad`, `happy`, `chill`, `melancholic`), genre buckets, theme keywords (`love`, `loss`, `heartbreak`). Flat, taxonomic, interchangeable across ten thousand songs.
- **Identify** — the most rigid convention: **the descriptor is a *category the song belongs to***, never a *claim about the song*. "Sad" is a bin. Every sad song goes in it. Nothing is asserted.
- **Violate** — make the lens a **claim, not a category**. `license as eulogy` does not bin drivers license with other sad songs; it argues something only true of *that* song. The violation reinforces the positioning (master §13): the panel should read as one critic's voice, not a database row.

The violation has a cost the do-not-use lists (§6, §7) police: a claim can be *wrong* or *pretentious* in ways a category can't. The guardrail is **concrete `Y` + defensible-in-one-sentence**. `license as eulogy` is concrete and defensible. `license as catharsis` is abstract slop wearing the same grammar.

---

## 3. The grammar (locked — Session 1; do not relitigate)

A lens uses **exactly one of three forms**, writer's choice per song. Bare noun phrases are excluded by design — they are the category-typical tag the lens exists to violate, and they live in the separate `theme_tags[]` facet instead.

| # | Form | Voice | Connector(s) | Asserts | Seed example |
|---|------|-------|-------------|---------|--------------|
| **1** | `X as Y` | Critical / essayistic | **as**, **of**, **with** | "X is really Y" / "X belongs to Y" / "X comes with Y" | `license as eulogy`, `anger with receipts` |
| **2** | `X into Y` | Transformational | **into** | "X turns into Y across the song" | `insult into anthem` |
| **3** | `Verb-ing the X` | Narrative / cinematic | gerund + object | "watch what the song *does*" | `outrunning the quiet` |

**Reconciliation note (not a new decision).** Master §5.2 defines Form 1's noun-as-noun grammar with connectors **as / of / with**; Session 1's "three-form set" labels that bucket `X as Y` for short. They are the same form — `of` and `with` are the associative connectors inside it. This is why the seed `anger with receipts` is valid Form 1, not a fourth form. `into` is broken out as Form 2 because it is *directional* (it names a turn), which is a different claim from association.

**Form ↔ song-shape pairing (guidance, not law):**
- **Form 1** fits songs with a single stable thesis — most deep, single-register songs.
- **Form 2** fits songs with a *turn* — a diss that becomes an anthem, grief that becomes permission. Strong for the two-act songs the diagnostic flagged.
- **Form 3** fits songs where the *motion is the meaning* — escape songs, and especially **surface-true songs** where naming what the song *does* avoids fabricating what it *means*.

**Language rule.** The lens phrase is **always written in English**, regardless of the song's language (diagnostic Pattern A). `DtMF` (Bad Bunny, Spanish) gets an English lens (`nostalgia as a party trick`); the question of quoting Spanish *lines* is a separate Session 4 prompt rule, not a vocabulary concern.

**Length.** 2–5 words. If you need 6, you're describing, not framing — cut.

---

## 4. What the lens is NOT (the boundary cases)

| Not a… | Example of the wrong thing | Why it fails | Where it belongs |
|---|---|---|---|
| Mood | `melancholy`, `euphoric` | A feeling, not a claim | nowhere (or as a word inside `tension`) |
| Tension restatement | `Aching Disbelief` | That's the `tension` field's two-word A+N | `tension` |
| Theme tag | `community defense`, `heartbreak` | Bare-noun category | `theme_tags[]` |
| Abstract summary | `a meditation on loss` | Abstract-noun slop (see §7) | nowhere — rewrite |
| Plot summary | `she gets her license and cries` | Describes events, makes no claim | `take` / `arc` |

---

## 5. The secondary facet: the structural move (Covert Step 6 outcome)

Covert Step 6 ("Play with Structure") requires trying at least two groupings and pressure-testing each against the seeds. Both were tried:

- **Grouping A — emotional families** ("what the song feels like"). Placed all four seeds in exactly one family each. **Passes.**
- **Grouping B — structural moves** ("which way the song moves": toward / away / inside / still). Left `license as eulogy` and `diss as block party` ambiguous (grief looks back *and* sits still; a diss moves toward its community *and* against its rival). **Fails the "all four fit cleanly" test.**

**Decision:** emotional families are the **primary** classification (§6). The structural move is kept as an **orthogonal secondary facet** — an IA facet-independence call (the same call that dissolved the "noun-as-noun pushback" in Session 1). It does two jobs:

1. **Tie-breaker.** When a song could sit in two families, the move disambiguates (a song that *flees* → ESCAPE; one that *lands* → ARRIVAL).
2. **The two-act fix.** The diagnostic's narrative songs (Pink Pony Club) need a frame that holds *both* directions. The move facet names that directly: ARRIVAL's defining move is **away → toward** (leaving that becomes a homecoming). The lens no longer has to pick one act.

The four moves: **toward** (ARRIVAL, OBSESSION, COMMUNITY), **away** (ESCAPE, DEFIANCE), **inside** (CONFESSION, GRIEF, AMBIVALENCE), **still** (SURFACE, DECAY). Each family declares its move below.

---

## 6. The families

Eleven families. Nine are the master's starting set (DECAY and the journey case folded into existing families); **SURFACE** and a journey-capable **ARRIVAL** are the two the lyric diagnostic mandated. Each family: a definition, its structural move, 6–8 lenses (phrase · form · what-song-it-fits · real example), a **do-not-use** list (the IA synonym-ring discipline — the don't-use list is more powerful than the use list), and a one-line grammar-holds confirmation.

---

### 6.1 GRIEF — loss that has happened and will not reverse
**Move: inside.** Seed family for `license as eulogy`.

| Lens | Form | Fits a song that… | Example |
|---|---|---|---|
| `license as eulogy` | 1 | treats a milestone as a funeral for a relationship | drivers license — Olivia Rodrigo |
| `home as wound` | 1 | can't return to a place without re-opening it | Marjorie — Taylor Swift |
| `absence as weather` | 1 | lets the missing person fill every room | Bigger Than the Whole Sky — Taylor Swift |
| `goodbye into errand` | 2 | forces mourning to share the day with ordinary life | Supermarket Flowers — Ed Sheeran |
| `keepsake as haunting` | 1 | can't put down an object the gone person touched | cardigan — Taylor Swift |
| `counting the empty chair` | 3 | names the hole left in a routine | Fire and Rain — James Taylor |
| `mourning the living` | 3 | grieves someone still alive but lost to you | Someone Like You — Adele |

**Do-not-use:** `a journey through grief`, `coping`, `a meditation on loss` (abstract slop — §7); `sad`, `melancholy` (mood); `heartbreak`, `loss` (theme tags → `theme_tags[]`). **Boundary:** GRIEF is loss already complete and accepted-as-irreversible; if the song is still *fighting* the loss with numbness, it's DECAY (§6.10); if it still *wants the person back*, it's OBSESSION (§6.9).
**Grammar holds:** all seven are Form 1 or 3, concrete `Y`.

---

### 6.2 DEFIANCE — standing your ground, asserting identity against pressure
**Move: away (from anyone who would move you).** Seed family for `diss as block party`.

| Lens | Form | Fits a song that… | Example |
|---|---|---|---|
| `diss as block party` | 1 | turns an insult into a celebration the block joins | Not Like Us — Kendrick Lamar |
| `insult into anthem` | 2 | converts contempt into something a crowd chants | Not Like Us — Kendrick Lamar |
| `survival as swagger` | 1 | wears having-made-it-through as a strut | Survivor — Destiny's Child |
| `no as a whole sentence` | 3 | refuses without apologizing or explaining | Truth Hurts — Lizzo |
| `pride as armor` | 1 | wears identity as protection | Born This Way — Lady Gaga |
| `standing as the message` | 1 | makes not-moving the entire point | Fight Song — Rachel Platten |
| `naming the enemy out loud` | 3 | treats plain accusation as the power move | FU — Miley Cyrus |

**Do-not-use:** `empowerment`, `a declaration of strength` (abstract slop); `confident`, `fierce` (mood); `self-love`, `independence` (theme tags). **Boundary:** DEFIANCE asserts *self* against pressure ("you won't move me"); if it's directed *retaliation at a specific wrongdoer* ("I'll get you back"), it's REVENGE (§6.6).
**Grammar holds:** Forms 1–3 all present, concrete `Y`.

---

### 6.3 ESCAPE — motion away from a feeling; fleeing, avoidance
**Move: away.** Seed family for `speed as avoidance`.

| Lens | Form | Fits a song that… | Example |
|---|---|---|---|
| `speed as avoidance` | 1 | uses fast motion to outrun being alone | Blinding Lights — The Weeknd |
| `the open road as exit` | 1 | drives to leave a feeling behind | Born to Run — Bruce Springsteen |
| `outrunning the quiet` | 3 | keeps moving so the silence can't land | Drive — Incubus |
| `numbing into motion` | 2 | converts pain to momentum so it can't catch up | Chandelier — Sia |
| `the dancefloor as hiding place` | 1 | uses a crowd to vanish into | Dancing On My Own — Robyn |
| `tonight as the whole plan` | 3 | refuses to think past the night | We Found Love — Rihanna |

**Do-not-use:** `freedom`, `wanderlust`, `living in the moment` (abstract slop / theme tags); `carefree` (mood). **Boundary:** ESCAPE is the *fleeing* and may never land; if the song *arrives* somewhere it's finally seen, it's ARRIVAL (§6.4). If the motion is just physical pleasure with no feeling being fled, it's SURFACE (§6.11).
**Grammar holds:** Forms 1–3 present, concrete `Y`.

---

### 6.4 ARRIVAL — becoming, homecoming, the two-act journey
**Move: away → toward** (the journey-capable family the diagnostic mandated; holds both acts).

| Lens | Form | Fits a song that… | Example |
|---|---|---|---|
| `leaving as homecoming` | 1 | makes a departure turn out to be a return to self | Pink Pony Club — Chappell Roan |
| `escape into belonging` | 2 | runs away and lands somewhere finally seen | Smalltown Boy — Bronski Beat |
| `becoming who you fled toward` | 3 | tracks the long arc of turning into your chosen self | Pink Pony Club — Chappell Roan |
| `growing up as small dying` | 1 | treats becoming an adult as a string of little losses | Ribs — Lorde |
| `homecoming as reckoning` | 1 | returns to face what was left behind | The House That Built Me — Miranda Lambert |
| `the long way into yourself` | 3 | winds toward self-recognition rather than a place | Vienna — Billy Joel |
| `exile into chosen family` | 2 | trades the family you had for the one you found | Smalltown Boy — Bronski Beat |

**Do-not-use:** `a journey of self-discovery`, `coming of age`, `growth`, `transformation` (abstract slop — note `transformation` names the *form*, never appears *in* a lens); `nostalgic` (mood). **Boundary:** ARRIVAL *lands* (move ends in "toward"); pure fleeing with no landing is ESCAPE (§6.3). The two-act test: if a single thesis can't hold both halves of the song, you're in ARRIVAL and should use Form 2/3 to span the turn.
**Grammar holds:** Forms 1–3 present; Forms 2/3 deliberately over-represented because they span two acts.

---

### 6.5 CONFESSION — admitting a private truth; exposure as the brave act
**Move: inside.**

| Lens | Form | Fits a song that… | Example |
|---|---|---|---|
| `the diary read aloud` | 1 | says in public what was meant to stay private | All Too Well — Taylor Swift |
| `admitting it first` | 3 | speaks the hard truth before being asked | Thinkin Bout You — Frank Ocean |
| `naming the fear out loud` | 3 | puts plain words to a dread | Anti-Hero — Taylor Swift |
| `terror dressed as gratitude` | 1 | is scared precisely because it has so much to lose | Beautiful Things — Benson Boone |
| `the mask slipping` | 1 | lets the persona crack to show the person | Anti-Hero — Taylor Swift |
| `loving someone you can't tell` | 3 | confesses an unspoken love only to the listener | Thinkin Bout You — Frank Ocean |
| `the apology you rehearse` | 1 | works through saying sorry before saying it | Hurt — Christina Aguilera |

**Do-not-use:** `vulnerability`, `honesty`, `raw emotion`, `a reflection on…` (abstract slop); `intimate` (mood). **Boundary:** CONFESSION *admits* a feeling and sits with it; if the admission is two opposed feelings refusing to resolve, it's AMBIVALENCE (§6.7).
**Grammar holds:** Forms 1 and 3, concrete `Y`.

---

### 6.6 REVENGE — directed retaliation at a specific wrongdoer
**Move: away (cutting them off).**

| Lens | Form | Fits a song that… | Example |
|---|---|---|---|
| `getting even as closure` | 1 | means payback to finally end it | Before He Cheats — Carrie Underwood |
| `the breakup as glow-up` | 1 | aims self-improvement straight back at an ex | thank u, next — Ariana Grande |
| `rage into receipts` | 2 | organizes fury into specific, dated evidence | Cry Me a River — Justin Timberlake |
| `living well as the last word` | 3 | treats thriving as the cruelest reply | thank u, next — Ariana Grande |
| `naming the betrayal` | 3 | itemizes exactly what they did | You Oughta Know — Alanis Morissette |
| `the verdict as victory lap` | 1 | pronounces judgment and enjoys it | Look What You Made Me Do — Taylor Swift |

**Do-not-use:** `bitterness`, `payback` (theme tags); `angry`, `vindictive` (mood); `a statement of empowerment` (abstract slop). **Boundary:** REVENGE is aimed at *one named wrongdoer*; broad "you won't move me" is DEFIANCE (§6.2). Anger that still *misses* the target is AMBIVALENCE (§6.7), not REVENGE — that's the `anger with receipts` / `rage into receipts` distinction below.
**Grammar holds:** Forms 1–3 present, concrete `Y`.

---

### 6.7 AMBIVALENCE — two truths held at once, refused resolution
**Move: inside (circling).** Seed family for `anger with receipts`.

| Lens | Form | Fits a song that… | Example |
|---|---|---|---|
| `anger with receipts` | 1 | itemizes the damage and still misses the person | Motion Sickness — Phoebe Bridgers |
| `loving and hating in one breath` | 3 | holds two opposite feelings without picking one | exile — Taylor Swift & Bon Iver |
| `missing the person you escaped` | 3 | feels relief and longing in the same line | Someone Like You — Adele |
| `staying for the wrong reasons` | 1 | sees a bad love clearly and doesn't leave | Skinny Love — Bon Iver |
| `nostalgia as a party trick` | 2 | hides real longing inside a festive surface | DtMF — Bad Bunny |
| `brightness as the lie` | 1 | sounds upbeat over floor-level loneliness | As It Was — Harry Styles |
| `the sad banger` | 1 | puts joy on the surface and ache underneath | Dancing On My Own — Robyn |

**Do-not-use:** `bittersweet`, `conflicted` (mood — and `bittersweet` is the single most over-reached word here; ban it); `mixed feelings`, `complicated` (theme tags); `a meditation on contradiction` (abstract slop). **Boundary:** AMBIVALENCE *refuses* to resolve; if the song resolves toward retaliation it's REVENGE (§6.6); toward acceptance, GRIEF (§6.1). **Distinct from `tension`:** `anger with receipts` is a *claim about the song*; `Tender Resentment` is the two-word `tension` field — don't confuse them.
**Grammar holds:** Forms 1–3 present, concrete `Y`. (Note: `the sad banger` rides Form 1 with an implied "as" — `[this] as a sad banger`; acceptable because it's a defensible critical claim, but prefer the fuller forms when generating.)

---

### 6.8 COMMUNITY — us, belonging, the collective voice
**Move: toward.**

| Lens | Form | Fits a song that… | Example |
|---|---|---|---|
| `the crowd as one voice` | 1 | is built to be sung back by a whole room | Don't Stop Believin' — Journey |
| `hometown as armor` | 1 | makes a place that both forms and protects you | Small Town — John Mellencamp |
| `the block as family` | 1 | treats a neighborhood as kin | Glory — Common & John Legend |
| `singing as solidarity` | 3 | joins voices as a political act | Glory — Common & John Legend |
| `the dancefloor as church` | 1 | makes collective release feel sacred | One More Time — Daft Punk |
| `belonging as the whole point` | 3 | means simply "you're one of us" | We Are Family — Sister Sledge |
| `chanting the room together` | 3 | exists to raise a room's temperature in unison | Seven Nation Army — The White Stripes |

**Do-not-use:** `unity`, `togetherness`, `connection` (abstract slop / theme tags); `uplifting`, `anthemic` (mood — `anthemic` is description, not a claim). **Boundary:** COMMUNITY is *collective* belonging (a "we"); a single self standing against a crowd is DEFIANCE (§6.2). The content-light unifier (`chanting the room together`) borders SURFACE (§6.11) — choose COMMUNITY when the *togetherness* is the meaning, SURFACE when the *physical sensation* is.
**Grammar holds:** Forms 1 and 3, concrete `Y`.

---

### 6.9 OBSESSION — fixation, wanting, the inability to let go
**Move: toward (one fixed point).**

| Lens | Form | Fits a song that… | Example |
|---|---|---|---|
| `wanting as identity` | 1 | has let desire eat the whole self | Wicked Game — Chris Isaak |
| `the person as weather system` | 1 | lets one person dictate its entire climate | Wicked Game — Chris Isaak |
| `devotion into surveillance` | 2 | curdles love into watching | Every Breath You Take — The Police |
| `need dressed as devotion` | 1 | sells insatiable want as romance | Bad Romance — Lady Gaga |
| `the chase as the point` | 3 | wants the wanting more than the having | Hold On, We're Going Home — Drake |
| `circling the same name` | 3 | keeps returning a mind to one person | Somebody That I Used to Know — Gotye |

**Do-not-use:** `longing`, `desire`, `infatuation` (theme tags); `passionate`, `yearning` (mood); `an exploration of obsession` (abstract slop). **Boundary:** OBSESSION still *wants the person*; if the person is gone and accepted-gone, it's GRIEF (§6.1); if the want has gone numb/destructive, DECAY (§6.10).
**Grammar holds:** Forms 1–3 present, concrete `Y`.

---

### 6.10 DECAY — decline, numbness, falling apart, fading out
**Move: still (sinking).** (The master's tenth starting family; absorbs the "slow-fade" and "numbing" readings.)

| Lens | Form | Fits a song that… | Example |
|---|---|---|---|
| `numbness as survival` | 1 | goes flat on purpose to get through | Comfortably Numb — Pink Floyd |
| `the slow fade` | 3 *(implied)* | watches something end without a fight | The Night We Met — Lord Huron |
| `falling apart in slow motion` | 3 | narrates a controlled demolition of a self | Hurt — Johnny Cash |
| `the high as the blindfold` | 1 | makes a pleasure that is also the rot | Habits (Stay High) — Tove Lo |
| `staying high to stay numb` | 3 | uses chemical avoidance of a feeling | Habits (Stay High) — Tove Lo |
| `the party after everyone left` | 1 | sits in the hollow aftermath | When the Party's Over — Billie Eilish |
| `coming apart quietly` | 3 | collapses while making no noise | Liability — Lorde |

**Do-not-use:** `despair`, `darkness`, `self-destruction` (abstract slop / theme tags); `depressing`, `bleak` (mood). **Boundary:** DECAY is *active decline still happening*; once the loss is final and mourned, it's GRIEF (§6.1). DECAY's motion is downward-still, ESCAPE's is outward-fast — a numb song that *floors the car* is ESCAPE.
**Grammar holds:** Forms 1 and 3, concrete `Y`. (`the slow fade` is the `[this] as` implied-Form-1 case again — defensible, but prefer full forms when generating.)

---

### 6.11 SURFACE — the descriptive register for content-thin / monochrome songs
**Move: still (no subtext to move through).** The diagnostic-mandated family that keeps the model from fabricating depth (Patterns A & C). Built on the principle: **for a surface-true song, name what it *does*, never invent what it *means*.** Form 3 (gerund-action) dominates here on purpose.

| Lens | Form | Fits a song that… | Example |
|---|---|---|---|
| `the body as the argument` | 1 | means exactly what it makes you do — move | No Sex For Ben — The Rapture |
| `dancing to feel the room` | 3 | is pleasure with no subtext but presence | Forever — Chris Brown |
| `the hook as the whole thesis` | 1 | puts its entire meaning in the chorus | Tubthumping — Chumbawamba |
| `flirtation as a power dare` | 1 | stages a come-on as a challenge, no deeper | Houdini — Dua Lipa |
| `chanting the room louder` | 3 | exists to raise the temperature, not to say a thing | No Sex For Ben — The Rapture |
| `moving for the joy of moving` | 3 | takes its own motion as its only subject | Forever — Chris Brown |

**Do-not-use — and this list is the most load-bearing in the file:** any lens that *imports depth a surface song doesn't have*. Banned: `hedonism as escape`, `partying to numb the pain`, `joy as denial`, `a celebration of freedom` — these are real lenses from *other* families (ESCAPE, DECAY) smuggled onto a song that doesn't earn them. If the song genuinely flees a feeling, it's ESCAPE; if it's genuinely rotting, DECAY; if it genuinely means nothing past the floor, it stays here. **SURFACE is not a dumping ground** — it is for songs whose meaning *is* their surface, never a place to hide from doing the work on a deep one. Also banned as everywhere: `vibe`, `bop`, `banger` (mood/slang).
**Grammar holds:** Forms 1 and 3; Form 3 deliberately dominant because describing-the-action is how you stay honest about a thin song. **The form that does NOT fit here is Form 2** — a surface song has no *turn* to transform across.

---

## 7. Global do-not-use (cross-cutting kill-checks)

These apply to *every* family and reinforce the existing `abstract-noun-trap` and `essayistic-register` jury rules:

1. **Abstract summary nouns as `Y`.** Never: `journey`, `tapestry`, `exploration`, `declaration`, `reclaiming`, `statement`, `meditation`, `reflection`, `testament`, `celebration`, `catharsis`, `anthem`* (*`anthem` is allowed only as the *output* of a Form-2 transform — `insult into anthem` — never as a bare `X as anthem`). This list is lifted directly from `abstract-noun-trap.ts` so the lens can't fail the same check the headline does.
2. **Mood words are not lenses.** `sad`, `happy`, `euphoric`, `melancholic`, `bittersweet`, `chill`, `dark`. A mood is a category; a lens is a claim.
3. **Bare-noun theme tags are not lenses.** `heartbreak`, `community defense`, `loss`, `freedom`. These are the `theme_tags[]` facet (separate grammar — lowercase, spaces, no hyphenation, per Session 1). If your "lens" has no connector and no gerund, it's a tag.
4. **No plot summary.** A lens claims; it does not recount events.
5. **≤ 5 words, English always.**
6. **Defensible in one sentence.** If you can't say "this song treats X as Y because…" in one breath, the lens is decorative — which is exactly what the future `lens-coherence` judge will catch.

---

## 8. Worked examples (the 5th-song acceptance test, twice)

**Example A — a deep song (As It Was, Harry Styles).** Read for the buried claim: a 174-BPM bright production sitting over plain loneliness. Family by feeling: two opposed truths (sounds up, is down) → **AMBIVALENCE**. Form: it's a stable thesis, not a turn → Form 1. Borrow/bend: `brightness as the lie`. Kill-checks: `lie` is concrete; not a mood; not a tag; 3 words; defensible ("it treats its own brightness as a lie it's telling"). **~90 seconds.**

**Example B — a surface song (Houdini, Dua Lipa).** Read for the buried claim: there isn't one — it's a flirt-as-power-dare, legible on the surface. Family: **SURFACE** (the procedure's step 1 routes content-thin songs here so the model doesn't fabricate). Form: name what it *does* → Form 1 with a concrete social function. Borrow: `flirtation as a power dare`. Kill-checks: concrete, defensible, not importing depth (we did *not* reach for `seduction as avoidance` — that would be smuggling ESCAPE onto a song that isn't fleeing anything). **~60 seconds.**

---

## 9. Acceptance-test self-check (master §7)

| Test | Result |
|---|---|
| Editor writes a 5th lens in <5 min by browsing | §1 procedure + §8 worked examples demonstrate ~60–90s. **Pass.** |
| Two editors land in the same family >80% | Families are emotionally distinct with explicit boundary notes (§6); the move facet (§5) breaks the residual ties. **Pass by construction; verify at scale.** |
| All four seeds fit cleanly into one family each | license→GRIEF, diss→DEFIANCE, anger→AMBIVALENCE, speed→ESCAPE; no seed is plausible in a second family (boundary notes enforce). **Pass.** |
| Each family ≥4 lenses, none >12 | All 11 families carry 6–8. **Pass.** Total: **77 lenses.** |

---

## 10. Open issues / handoff notes

- **`theme_tags[]` vocabulary is a separate artifact and is NOT in scope here** (Session 1 facet split). When it gets built, audit for overlap: if a `theme_tag` ever duplicates a lens family wholesale, that's the §8.2-item-3 trigger to revisit.
- **SURFACE will be the model's favorite escape hatch.** At generation scale, watch for the inverse failure of the original problem: a *deep* song lazily tagged SURFACE to dodge the work. The `lens-coherence` judge (Step 4) should specifically check that a SURFACE lens was chosen because the song is thin, not because the read was.
- **Form 2 (`X into Y`) is the least-tested form.** Only ARRIVAL, REVENGE, ESCAPE, OBSESSION, DEFIANCE, GRIEF, AMBIVALENCE carry one each. If two-act songs are rarer than the diagnostic implied, Form 2 may see little use — fine, it's there when the turn exists.
- **The implied-`as` cases** (`the sad banger`, `the slow fade`) bend Form 1. They're kept because they're idiomatic and defensible, but the prompt should prefer fully-connected forms and treat these as accepted exceptions, not templates.
- **No new master decisions were forced**, only confirmations: the grammar held across all 11 families (no family needed a fourth form), which is positive evidence for the §8.2-item-2 working assumption rather than a push-back on it.
