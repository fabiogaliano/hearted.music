# GPT deep research — studio suggestion quality (raw output)

Saved 2026-08-01. Shared prompt run through GPT deep research mode. Reconciled into
`docs/playlist-creation/studio-suggestion-quality.md` — this file is the unedited source.

---

# Improving Playlist Generation Quality in a Small Personal Music App

## Executive judgement

The highest-return change is **not** an industrial multi-interest neural model, a graph recommender, or a new foundation model. It is a disciplined separation of four concepts that the current score conflates:

1. **Long-term taste**: several recurring semantic and sonic interests, not one average vector.
2. **Session intent**: pinned songs and typed intent, which should temporarily dominate long-term taste without overwriting it.
3. **Evidence reliability**: missing metadata should mean "unknown", not "transfer its weight to a convenient signal".
4. **Learned curation preference**: explicit additions and removals should supply a small, bounded prior rather than become the principal ranker.

The recommended request-time pipeline is therefore:

> hard filters → modality-specific multi-interest scores → session-anchor scores → fixed-weight late fusion → specificity-aware confidence penalty → bounded feedback prior → the already-decided Gumbel sampling → MMR and artist cap → genre-calibrated re-ranking.

The main implementation priorities are:

| Priority | Recommendation | Expected value | Complexity |
|---|---|---:|---:|
| Immediate | Stop redistributing missing-signal weights; use a fixed neutral contribution plus a specificity-aware confidence penalty | Very high | Low |
| Immediate | Add seed-anchored session profiles using the maximum or soft maximum over individual pins, never their mean | Very high | Low |
| Immediate | Log exposures as well as add, pin, remove and dismiss events | Very high | Low |
| Next | Build separate text-space and audio-feature multi-interest profiles, cached per user | High | Moderate |
| Next | Add shrunk, time-decayed song/artist/genre feedback priors | High after enough events | Moderate |
| Next | Map Last.fm tags deterministically to a closed top-level taxonomy before using an LLM | Medium to high | Low |
| Later | Pilot an Essentia Discogs-EffNet audio embedding on a few hundred tracks | Uncertain but potentially useful | Moderate |
| Do not build yet | MIND, ComiRec, a learned graph model, reinforcement learning, MERT or CLAP serving infrastructure | Low return at this scale | High |

Industrial multi-interest systems provide strong evidence that a single user vector loses distinct interests. PinnerSage clusters user actions and represents clusters with medoids; MIND and ComiRec learn several interest vectors from sequential behaviour. However, MIND and ComiRec depend on trained item embeddings, large interaction datasets and supervised next-item objectives, while PinnerSage's production design addresses billion-item retrieval and infrastructure constraints that do not exist in a 500–1,000-song personal library. The transferable idea is **multiple interest heads plus context-dependent selection**; the non-transferable part is the neural routing, sampled-softmax training and industrial retrieval architecture.

## Representing long-term taste and session intent

### Build separate semantic and sonic interest profiles

Do not cluster one concatenated vector containing text, audio and genre. The dimensions have different meanings, scales, missingness patterns and failure modes. Instead, maintain two independent long-term profiles:

- a **semantic profile** from the 512-dimensional lyric, mood and theme embeddings;
- a **sonic profile** from the nine standardised audio features.

Genre remains a categorical distribution used in its own scoring and calibration stages.

This is a lightweight analogue of a multi-interest recommender: each user has several semantic centres and several sonic centres, but no training is required. PinnerSage's central finding—that clustering actions gives a richer representation than one user vector—is directly relevant. Its use of medoids is also useful because a medoid corresponds to a real liked item and is more interpretable and less prone to falling between coherent modes than an arbitrary average. PinnerSage reported that Ward clustering outperformed its k-means and complete-linkage alternatives, but that result was obtained on learned Pinterest embeddings and a next-action retrieval task, not on mixed music assets in a tiny application.

For this app, I would implement **spherical k-means for text** and ordinary k-means for standardised audio features, rather than Ward clustering in the request path. K-means costs approximately O(nkd) per iteration; Ward is quadratic in the number of items and PinnerSage itself describes its Ward implementation as O(n^2). At 1,000 items Ward remains feasible as an occasional cached job, but k-means is simpler to write efficiently in TypeScript and easier to recompute incrementally.

Use the following defaults:

| Parameter | Semantic profile | Sonic profile |
|---|---:|---:|
| Input | L2-normalised text embeddings | Robustly standardised audio features |
| Candidate k | 2 to min(8, floor(n/75)) | 2 to min(6, floor(n/100)) |
| Initialisation | k-means++ | k-means++ |
| Restarts | 5 | 10 |
| Maximum iterations | 30 | 30 |
| Minimum cluster size | 25 songs | 30 songs |
| Cluster representative | centroid for scoring, medoid for display | centroid for scoring, medoid for display |
| Recompute | When the library changes by at least 5%, or weekly | Same |

Choose the **smallest** k whose average silhouette score is within 0.02 of the best candidate and whose clusters satisfy the minimum-size rule. Silhouette analysis measures whether items are closer to their assigned cluster than to the nearest alternative cluster, but it is often ambiguous between neighbouring values of k; selecting the smallest near-optimal k deliberately favours stability over discovering fragile micro-clusters.

If no candidate k achieves an average silhouette of at least roughly 0.08–0.10, use one broad profile for that modality rather than forcing artificial clusters. That threshold is an engineering guard-rail, not a universal statistical boundary; it should be validated against whether the resulting medoids look recognisably distinct.

### Score against a mixture, not an average of centres

A candidate should not be compared to the mean of all interest centres. Nor should all centre similarities simply be averaged, which recreates the "average song wins" problem at another level.

For each modality, use a soft maximum:

T_i = tau * log( sum_j pi_j * exp( s(i, c_j) / tau ) )

where s(i, c_j) is cosine similarity for text or negative standardised distance for audio, and pi_j is the interest weight. Set tau = 0.05 for cosine scores after inspecting their empirical range; a practical alternative is simply the maximum similarity plus 0.10 * log(pi_j).

Use sub-linear cluster weights:

pi_j proportional to n_j^0.6

rather than raw cluster sizes. Raw frequency would allow the largest interest to swallow smaller but genuine tastes; equal weights would overstate a cluster containing only a few borderline items. PinnerSage similarly separates cluster representation from cluster importance and uses frequency plus recency to prioritise interests.

On the default path, use these two multi-interest scores even without a premium typed intent. This fixes the current waste of the semantic asset: the semantic embedding should represent long-term thematic and mood affinity even when no natural-language query exists.

### Let pins create session-specific interest heads

When a user pins two to five tracks, do **not** average their embeddings. An average of a metal song, an ambient song and a soul song can point to an area containing none of them.

Treat every pinned track as an independent session head. For candidate i:

S_pin,i = softmax_{p in P} ( 0.55 * s_text(i,p) + 0.35 * s_audio(i,p) + 0.10 * s_genre(i,p) )

where the soft maximum temperature is approximately 0.05–0.10. Renormalise the coefficients only within this pin-to-candidate comparison when a pin genuinely lacks a facet, but retain a reliability value for the resulting score. This is different from globally redistributing a missing song signal into unrelated ranker components.

For an artist pin, construct an artist session head from that user's known tracks by taking:

- the medoid text embedding;
- the median audio-feature vector;
- the shrunk artist genre distribution.

Do not use every artist track as an equal seed, because prolific artists would receive disproportionate influence.

A useful mode-dependent fusion is:

| Studio state | Session pins | Typed intent | Long-term text | Long-term audio | Genre compatibility | Feedback |
|---|---:|---:|---:|---:|---:|---:|
| Default | 0 | 0 | 0.25 | 0.30 | 0.25 | 0.20 |
| Pins only | 0.40 | 0 | 0.15 | 0.15 | 0.15 | 0.15 |
| Intent only | 0 | 0.40 | 0.10 | 0.20 | 0.15 | 0.15 |
| Pins and intent | 0.30 | 0.30 | 0.10 | 0.15 | 0.05 | 0.10 |

These are initial engineering values, not learned optima. Because Steck-style genre calibration will subsequently control the output distribution, the pointwise genre weight should not also be raised aggressively whenever pills are present; doing both risks over-correcting the list. Calibrated recommendation is a list-level objective, and its purpose is to reconcile relevance with a target category distribution rather than to make every item independently maximise category overlap.

### Do not add a random walk yet

A random walk with restart is reasonable when the graph contains information not already present in the direct similarity score—playlist co-occurrence, transitions, collaborative behaviour or heterogeneous artist/genre edges. Session-based random-walk methods can capture multi-step item relationships, and playlist research has used biased walks over similarity and contextual graphs.

In the present app, a graph built only from the same text and audio similarities would mostly be a computationally elaborate smoothing of nearest neighbours. It could also amplify hubs: broadly similar, mainstream songs receive many edges and become reachable from almost every seed.

Revisit a graph only after accumulating meaningful studio-session data. A future version could use a 15-neighbour graph with:

- content-similarity edges;
- same-artist edges with a capped weight;
- co-addition edges from independently curated sessions;
- negative edges or removed-neighbour suppression.

At that point, personalised PageRank with restart probability 0.25 from pinned songs would be a reasonable secondary signal. Until then it is overkill.

## Fusing text meaning with musical sound

### Use late fusion and explicit facet gates

The current embedding represents lyric narrative, emotional themes and a textual description of texture. It does not directly encode timbre, harmony, production, instrumentation or rhythmic detail. Text-derived lyric similarity also does not fully match human lyric-similarity judgements: semantic, stylistic and phonetic information all contribute, while pure lyric methods are inapplicable to instrumentals.

The safest design is therefore late fusion:

R_i = w_t * g_t,i * z_t,i + w_a * g_a,i * z_a,i + w_g * g_g,i * z_g,i + ...

Here g_m,i in [0,1] is a reliability gate, not a mechanism for transferring weight elsewhere.

Recommended gates include:

| Condition | Text gate | Audio gate | Genre gate |
|---|---:|---:|---:|
| Full lyric analysis | 1.0 | Based on coverage | Based on source |
| Analysis based on partial or uncertain lyrics | 0.6 | Based on coverage | Based on source |
| Instrumental or no lyrics | 0 | 1.0 if audio present | Based on source |
| Non-English lyrics analysed directly by a multilingual-capable process | 0.8–1.0 after validation | Based on coverage | Based on source |
| Analysis produced from translation | 0.6–0.8 | Based on coverage | Based on source |
| LLM-inferred genre only | Unchanged | Unchanged | 0.35–0.5 |

Cross-lingual lyrics-based genre classification can work when multilingual sentence embeddings are trained or evaluated for the task, but published results are normally limited to specific language pairs and relatively coarse taxonomies. They do not establish that an arbitrary English analysis of translated lyrics preserves culturally specific genre, prosody or wordplay.

### Route typed intents by what they are asking for

A typed query such as "songs about trying to forgive someone" is well served by the current text embedding. A query such as "warm analogue synths, no vocals, steadily building" is partly sonic and should not be allowed to rely on lyric/theme similarity alone.

A cheap router can classify the intent into non-exclusive facets using a closed keyword/rule set, optionally supplemented by the same already-budgeted LLM call that processes the intent:

- **theme or narrative**: heartbreak, grief, revenge, friendship, growing up;
- **emotion**: euphoric, tense, melancholy, calm;
- **sound or production**: distorted, acoustic, orchestral, lo-fi, heavy bass;
- **activity or trajectory**: running, studying, late-night driving, builds slowly;
- **literal metadata**: instrumental, female vocals, 1990s, Portuguese.

Then allocate the intent weight by facet. For example:

| Intent mixture | Text intent | Audio profile/targets | Genre | Metadata constraints |
|---|---:|---:|---:|---:|
| Theme-heavy | 0.65 | 0.15 | 0.10 | 0.10 |
| Emotion-heavy | 0.45 | 0.35 | 0.10 | 0.10 |
| Sound-heavy | 0.20 | 0.55 | 0.15 | 0.10 |
| Activity-heavy | 0.25 | 0.50 | 0.15 | 0.10 |

Initially, "audio targets" can be simple functions over the nine features: "energetic" raises energy and loudness; "acoustic" raises acousticness; "danceable" raises danceability; "spoken" raises speechiness. Do not pretend these nine features cover timbre or instrumentation, but they are a more defensible response to a sonic phrase than a lyric embedding.

### Split the existing text analysis into facets only if embedding cost is negligible

If the analysis is stored in structured fields, a useful later improvement is to embed three separate strings:

- narrative and lyrical theme;
- mood and emotional trajectory;
- sonic-texture description.

This does not require another generative LLM call, only additional embedding calls. It reduces cases where two tracks score highly because their lyrics share a subject even though the user's query concerns texture.

This is worthwhile only if the embedding bill and storage are genuinely negligible. Three 512-dimensional pgvector columns per song remain small at this scale, but per-facet embeddings should be validated by holding out curated playlists or interleaving them against the single-embedding version. Do not introduce a learned cross-modal projector; there is nowhere near enough supervised data.

### Audio embeddings are a pilot, not a prerequisite

Among cheap audio models, the best fit is an **offline Essentia Discogs-EffNet embedding**, conditional on lawful access to audio or preview clips. Essentia provides pretrained embedding models, including a Discogs-EffNet trained to predict 400 Discogs styles and contrastively trained variants based on artist, label, release and track relationships. Its documented pipeline loads audio at 16 kHz and produces embeddings using a packaged TensorFlow model.

A practical pilot would:

1. sample 200–300 tracks, deliberately including instrumentals, genreless songs, non-English songs and same-theme/different-sound pairs;
2. extract embeddings from a consistent 20–30-second excerpt;
3. mean-pool frame embeddings and L2-normalise;
4. inspect nearest neighbours and run an interleaving test against the nine-feature sonic score;
5. proceed to the full library only if the improvement is obvious.

MusiCNN is easier and has an Essentia.js implementation, but its standard MSD representation is based on the 50 most common Last.fm/Million Song Dataset tags. It may still help, but Discogs-EffNet is better aligned with broad musical style and similarity. Essentia also provides downstream models for mood, danceability, instrumental/voice and vocal gender, which could help fill selected metadata gaps without using an LLM.

MERT and CLAP are technically impressive but operationally disproportionate here. MERT ranges from 95 million to 330 million parameters and was trained for broad music-understanding tasks; CLAP learns a joint audio–language space from hundreds of thousands of audio-text pairs and is attractive for text-to-audio retrieval. Neither removes the need to acquire and preprocess audio, and both introduce a Python/PyTorch-style model-serving stack or an offline batch system substantially heavier than the rest of the application.

**Recommendation:** ship the ranking and confidence fixes first. Pilot Essentia only after logs show that a meaningful share of failures are genuinely "right meaning, wrong sound". MERT and CLAP are overkill at 30 users.

## Ranking low-information songs without rewarding ignorance

### Missing means neutral, not "give its weight to something else"

The current proportional redistribution creates a systematic advantage for incomplete items. If genre is missing, its weight moves into audio proximity; if text is also missing, nearly the entire score can become whichever remaining signal happens to be favourable.

For every scoring mode, define the complete set of weights in advance. Standardise each signal over candidates for which that signal exists, then assign a missing signal a neutral standardised value of zero:

R_i = sum_m w_m * g_m,i * z_m,i

Do not divide by sum_m w_m * g_m,i. The reliability gates influence confidence and, where appropriate, attenuate the corresponding evidence; they must not increase another component.

This is conceptually different from positive–unlabelled recommendation, where an absent interaction is not necessarily a negative. Here the missing value is not preference evidence at all. Treating absent data as a strong positive is therefore unjustified. More generally, recommender-system missingness is rarely random, so a procedure that systematically rewards it can reproduce coverage and popularity biases.

### Compute weighted evidence coverage

Define:

c_i = ( sum_m w_m * r_m,i ) / ( sum_m w_m )

where the evidence reliability r_m,i is:

- 1.0 for direct song-level evidence;
- n/(n+5) for an artist fallback derived from n known tracks;
- 0.35–0.5 for a validated LLM-inferred label;
- 0 for a pure library-mean fallback.

Then add a specificity-aware penalty:

P_i = -[0.10 + 0.25*q] * (1 - c_i)

where q is request specificity:

- q=0: no pins, pills or intent;
- q=0.4: soft genre pills;
- q=0.7: pins or a broad intent;
- q=1: a narrow typed intent or a strict preference combination.

The maximum penalty is therefore roughly -0.35 fused-score units, assuming other components are expressed in z-score units. It is deliberately noticeable but unable to bury an item by itself.

This implements a form of pessimism under uncertainty when the user has expressed a specific request. Uncertainty-aware recommendation research shows that uncertainty can be used either to surface less-known items or to make safer choices; which direction is appropriate depends on the product objective. In this app, uncertainty concerns **match to the current brief**, not whether the user likes the song at all—the song is already in their liked library. Optimistic UCB-style treatment is therefore appropriate only for explicit exploration, not for claiming that an unknown-language or genreless item satisfies a precise request.

### Use a strict backoff hierarchy

For each attribute, use:

> song evidence → artist aggregate → user-library prior → unknown.

The library prior must be neutral in ranking. It may be used to avoid numerical failure, but should have reliability zero because it says nothing song-specific.

For artist genre fallback, calculate a weighted artist distribution from the user's known tracks:

p(g|a) = ( C_a,g + eta * p(g|u) ) / ( sum_h C_a,h + eta )

with eta = 5. Use it only when at least three artist tracks have known genre evidence. This is a small hierarchical shrinkage model: three tracks produce a tentative fallback, while a large catalogue can support a more confident artist profile. Recent work on music cold start likewise finds that artist catalogues provide valuable hierarchy-level information when track evidence is missing, although its learned collaborative setting is much larger than this app.

Never use artist-level fallback for a strict song-language filter or a vocal-gender filter. An artist can release songs in different languages, collaborate with other vocalists, or make instrumentals.

### Treat hard-filter unknowns as unverified

For a hard language, release-year or vocal-gender filter, unknown values should not silently pass.

Use this policy:

- If enough verified candidates exist, exclude unknowns.
- If fewer than 1.5N candidates remain for an N-track request, show a clear "include songs with unknown metadata" option or add a separately labelled fallback pool.
- Unknowns admitted through that fallback pool receive the full specificity confidence penalty.

This is the principled form of "abstain from ranking high": the ranker should not assert compliance where it lacks evidence.

### Reserve a small exploration quota on broad requests

To keep obscure, instrumental and non-English items from disappearing forever, reserve approximately:

E = max(1, round(0.07 * N))

positions for low-information tracks when q <= 0.4. Choose those tracks using available audio similarity, artist fallback, the feedback prior, Gumbel sampling and MMR. Apply the same two-per-artist cap.

Do not use this quota for narrow intents or strict filters. Exploration and exploitation should be separated rather than hidden inside every score.

## Learning from adds, pins, removals and dismissals

### Log exposure and context before building priors

Every event must include:

- user, song and artist;
- session and timestamp;
- whether the song was initially generated, suggested later or manually searched;
- displayed position;
- ranker attribution during experiments;
- active pins, genre pills, filters and intent facet;
- action: add, pin, remove, dismiss, publish or no action.

An absence of interaction is not a negative unless the UI establishes that the user examined the candidate. Research on implicit feedback repeatedly warns that non-interaction can reflect lack of exposure rather than dislike.

Explicit negative feedback is unusually valuable because recommenders normally have abundant positive behaviour but weak evidence of true dislike. Music-specific work has shown benefits from using real negative feedback both in behaviour sequences and as negative training targets.

### Use fractional Beta-Binomial counts

For an entity e—song, artist or genre—maintain decayed positive and negative counts:

P_e = sum_t w+_t * d_t,  N_e = sum_t w-_t * d_t

with initial event weights:

| Event | Positive count | Negative count |
|---|---:|---:|
| Pin | 2.0 | 0 |
| Explicit add | 1.0 | 0 |
| Remove from generated list | 0 | 1.5 |
| Dismiss from suggestion tray | 0 | 1.0 |
| No action | 0 | 0 |

These weights encode the recommendation that an explicit removal is a stronger session-mismatch signal than a routine addition, while a pin is the strongest positive signal. They should be treated as tunable product semantics, not empirical constants.

Let p_0 be the user's overall positive rate among explicit positive and negative actions. Use a Beta prior with strength m = 8:

alpha_0 = m * p_0,  beta_0 = m * (1 - p_0)

and posterior:

p_hat_e = ( alpha_0 + P_e ) / ( alpha_0 + beta_0 + P_e + N_e )

The Beta-Binomial construction supplies conjugate shrinkage: entities with one event remain close to the user baseline, while repeated evidence can move the estimate.

At only 30 users, estimate priors per user rather than fitting a complicated population-level empirical-Bayes model. Once there are thousands of actions, m can be estimated from the dispersion of entity rates, but hand-setting m = 8 is more stable during launch.

### Apply different half-lives to different meanings

Use exponential decay:

d_t = 2^(-delta_t / H)

with the following starting half-lives:

| Evidence | Half-life |
|---|---:|
| Song removal or dismissal | 60 days |
| Song add | 120 days |
| Artist and genre aggregates | 180 days |
| Pin | 365 days |
| Within-current-session action | No decay during session |

Temporal recommenders commonly use exponential or half-life decay to represent preference drift, but published optimal values vary by domain and data. A half-life study on ratings found a value around 150 days in its particular dataset; that should be read as support for the form of the decay, not as a transferable music constant.

The asymmetry above reflects event semantics. Removing a track from "high-energy running songs" should decay relatively quickly because it may not indicate global dislike. A pin is closer to a durable endorsement.

### Bound generalisation aggressively

Compute the centred log-odds effect:

b_e = tanh( ( logit(p_hat_e) - logit(p_0) ) / 1.5 )

Combine entity levels as:

B_i = 0.60*b_song + 0.30*b_artist + 0.10*b_genre

and clip B_i to [-1, 1]. Do **not** z-score this sparse prior within each request: if almost every candidate has zero feedback and one item has a negative event, request-level z-scoring can turn that event into a many-standard-deviation outlier.

Use a final feedback contribution of approximately 0.15 * B_i on ordinary requests, with an absolute cap of 0.25 fused-score units.

Additional guard-rails are essential:

- A single removed song may lower that song but must not lower its artist.
- Artist negative evidence activates only after removals of at least three distinct songs across at least two sessions.
- Artist contribution is capped at -0.30 before the 0.30 artist mixture coefficient.
- Genre negative evidence requires at least five distinct-song events and is capped at -0.20.
- A later pin clears or overwhelms the decayed song-level negative.
- An artist pin overrides artist-level negatives for the current session.

Negative preferences can be used as exclusion constraints, ranking penalties or approximate preference evidence; the safest choice here is a bounded ranking penalty because a studio removal usually means "wrong for this playlist", not "never show this artist again".

### Keep contextual and global feedback distinct

Store the context even if the first implementation uses only a global prior. As volume grows, split each event into:

- a small persistent component, approximately 25% of its weight;
- a contextual component, approximately 75%, attached to the session's genre pills and intent facets.

A removed sad ballad in a workout session should become evidence against that ballad for energetic contexts, not strong evidence against ballads globally. Full contextual Bayesian modelling is unnecessary; a nearest-context weighted sum over prior events is enough once a user has at least 30–50 events.

## Filling genre and metadata gaps

### Use an actual closed top-level taxonomy

"MusicBrainz top-level genres" is not quite the right description. MusicBrainz maintains a large approved genre list within its tagging system, but it is not a compact, fixed top-level hierarchy. The official genre list contains many fine-grained genres and continues to expand.

For this app, use the published AcousticBrainz/Last.fm mapping to 16 top-level categories:

> African, Asian, avant-garde, blues, Caribbean and Latin American, classical, country, easy listening, electronic, folk, hip hop, jazz, pop, rhythm and blues, rock, and ska.

AcousticBrainz produced these annotations by matching free-form Last.fm tags against a genre tree, mapping subgenres to top-level categories, combining their weights and discarding unmatched tags. The released dataset covered hundreds of thousands of MusicBrainz identifiers and more than 1.7 million AcousticBrainz recordings.

This mapping is preferable to asking an LLM to reinterpret every existing Last.fm tag. MetaBrainz also publishes code and data-processing work for matching external genre annotations into its genre/tag structure, while the AcousticBrainz Genre Dataset explicitly studies hierarchical, multi-source genre annotations.

### Apply a deterministic-first evidence ladder

For each song:

1. Map Last.fm tags through the published canonical mapping.
2. Query or reuse matched MusicBrainz recording, release and artist metadata where available.
3. Back off to the shrunk artist genre distribution.
4. Use an LLM only for unresolved or weakly resolved cases.
5. Retain `unknown` when evidence is insufficient.

The LLM input should include only grounded assets already held:

- artist, title and album;
- mapped and unmapped Last.fm tags with weights;
- the existing lyric/mood analysis;
- audio-feature values converted to human-readable bands;
- known artist-level genre evidence.

Use schema-constrained output similar to:

```json
{
  "genres": ["rock", "folk"],
  "confidence": 0.78,
  "evidence": ["lastfm_tag", "artist_catalogue", "audio_features"],
  "abstain": false
}
```

The genre field must be an enum array with at most two entries. Include an explicit `unknown` or `abstain` outcome. A mandatory genre field pressures the model to invent an answer where none is warranted.

Constrained decoding and JSON Schema can enforce syntactic validity, but they do not make the selected label semantically correct. Structured-output research and hallucination surveys make this distinction explicit: a perfectly valid JSON object can still contain an unsupported classification.

### Treat LLM genre as weak evidence

Genre is partly acoustic, historical and community-defined. Lyrics alone can correlate with genre, and multilingual sentence embeddings have been used for coarse genre classification, but a lyric about heartbreak does not distinguish country, soul, pop-punk and reggaeton reliably. Folksonomy and expert taxonomies also disagree for some broad categories; older comparative work found stronger agreement for genres such as blues and hip-hop than for rock.

Recommended acceptance rules are:

| Result | Use |
|---|---|
| Deterministic Last.fm mapping | Full genre evidence |
| Artist fallback with at least three tracks and concentrated distribution | Reliability n/(n+5), capped at 0.8 |
| LLM confidence >=0.80 and agreement with at least one grounded source | Reliability 0.5 |
| LLM confidence 0.60–0.79 | Reliability 0.3; ranking only |
| LLM confidence <0.60 or `abstain` | Unknown |
| LLM contradicts two grounded sources | Reject LLM result |

Do not use an LLM-inferred genre as proof for a hard filter until it has passed a manual precision audit.

There is no credible universal published "LLM hallucination rate for song-genre classification" that transfers to this setup. Hallucination depends on the model, prompt, taxonomy, languages, input evidence and definition of an error. Measure it locally with a stratified audit of at least 200 songs:

- 50 common English-language tracks;
- 50 obscure tracks;
- 50 non-English tracks;
- 50 instrumentals or tracks without lyrics.

Report precision, abstention rate and coverage separately. Optimise precision first: an `unknown` song can still enter exploration, whereas a confidently false label corrupts filtering and calibration.

### Use artist fallback selectively

Artist fallback is appropriate for genre and broad sonic style when the artist's user-library catalogue is coherent. Compute its confidence from both catalogue size and entropy:

r_a = ( n / (n+5) ) * ( 1 - H(p_a)/log(G) )

where G is the number of top-level genres. A single-genre artist with many tracks receives high confidence; a cross-genre artist receives little fallback confidence even with many tracks.

Do not infer song language, vocal gender, explicitness or release year from the artist profile. For missing vocal/instrumental and gender attributes, an offline Essentia classifier is more defensible than artist-level inference because Essentia publishes pretrained voice/instrumental and vocal-gender models.

## Evaluating changes with thirty users

### Use interleaving only for pointwise ranking changes

Team-draft interleaving creates one list by randomly choosing which ranker drafts first and then alternating, with each ranker contributing its highest-ranked unseen item. This balances position opportunity and allows direct within-session comparison. Large-scale search studies found interleaving sensitive to ranking differences, and Netflix has described using team-draft interleaving to accelerate personalisation experiments.

For this app:

1. Ranker A and ranker B each produce at least 2N candidates after identical hard filters.
2. Flip a seeded coin for the first drafting team.
3. Alternate teams.
4. On each turn, take that team's first unseen song that satisfies the shared max-two-per-artist rule.
5. Record the owner of every selected song.
6. If both rankers return the same item near the same position, mark it as shared and exclude it from ranker credit, or use a deduplicated attribution rule fixed before the experiment.

Deduplicated credit assignment has produced substantial sensitivity gains in published interleaving analysis.

For each owned item, assign: pin +2; add +1; remove -1.5; dismiss -1; no action 0.

Normalise ranker credit within the session:

D_s = ( C_A,s - C_B,s ) / ( 1 + |C_A,s| + |C_B,s| )

This prevents a small number of intensive editors from determining the result solely because they generated more actions.

Interleaving is suitable for comparisons such as:

- single centroid versus multi-interest profile;
- fixed missing weights versus redistributed weights;
- no feedback prior versus bounded feedback prior;
- text-only intent versus facet-gated intent.

It is **not** a clean test of list-wide properties such as MMR strength, artist caps or genre calibration. Classic interleaving assumes that utility decomposes into actions on individual items and explicitly struggles with global properties such as list diversity. Test those features with session-level A/B assignment or within-user alternating periods.

### Do not quote a universal minimum sample size

Required volume depends on baseline action rate, effect size, repeated users, ties and ranker overlap. As a rough independent-event calculation, detecting an increase from a 20% action rate to 25% with 80% power at a two-sided 5% level requires about 2,180 total item events; detecting 20% to 23% requires about 5,873. Those figures are optimistic here because events from the same 30 users and session are correlated.

Interleaving can be considerably more sensitive than ordinary A/B testing because both alternatives compete within the same user context, but "orders of magnitude" improvements reported in industrial search should not be treated as guaranteed in playlist curation.

Use these practical minimums before considering a decision:

- at least 15 distinct active users, preferably 20 or more;
- at least 150–200 **decisive sessions**, where ranker credits differ;
- at least two weeks, to avoid one-off usage patterns;
- no single user contributing more than 15% of decisive sessions;
- inspect tie rate and overlap rate as diagnostics.

For subtle changes, expect 500 or more decisive sessions. With 30 users, many experiments will correctly remain inconclusive; no statistical technique can manufacture information that was not observed.

### Use user-blocked Bayesian monitoring

Aggregate session scores per user:

D_u = mean over sessions of D_s

Then run a Bayesian bootstrap over users:

1. Draw weights (w_1, ..., w_U) ~ Dirichlet(1, ..., 1).
2. Calculate D^(b) = sum_u w_u * D_u.
3. Repeat 20,000 times in TypeScript.
4. Estimate P(D>0), the credible interval, and P(D>delta), where delta is a predeclared practically meaningful effect.

A reasonable stopping rule is:

- minimum-volume requirements above are met;
- P(D>0) > 0.975;
- P(D>delta) > 0.80;
- the posterior median is stable over two scheduled weekly looks.

For a negative decision, require P(D<0) > 0.95, or stop for futility when most posterior mass lies within a negligible-effect interval.

The Bayesian bootstrap is attractive because the app's target population is essentially these users and because resampling users respects within-user dependence. It remains a decision framework rather than a proof of generalisation to a broad market.

If frequentist error guarantees are required under continuous monitoring, use an always-valid test, confidence sequence or e-value. Ordinary p-values become invalid when repeatedly inspected and stopped opportunistically; always-valid inference was developed precisely to permit continuous monitoring.

### Interpret health metrics cautiously

Track at least:

| Metric | Definition | Principal pitfall |
|---|---|---|
| Pin rate | Pins divided by exposed eligible tracks | Depends strongly on how prominent or easy pinning is |
| Remove rate | Removed initial tracks divided by initial generated tracks | Longer lists mechanically create more removal opportunities |
| Add rate | Explicit additions divided by exposed suggestions | A high rate may mean excellent discovery or a poor initial list |
| Retention | Fraction of generated tracks present at publish | Penalises users who enjoy hands-on curation |
| Normalised edit distance | Insertions, deletions and moves divided by maximum list length | Conflates ranking quality, ordering preference and creative ownership |
| Publish rate | Sessions producing a published playlist | Sensitive to abandonment unrelated to recommendations |
| Time to publish | Active editing time | Faster is not always better if exploration is enjoyable |
| Low-information exposure | Share of output with low confidence | Detects accidental disappearance or domination of obscure tracks |
| Artist concentration | Largest artist share and effective artist count | Complements the hard artist cap |
| Genre calibration error | Distance from requested to delivered pill distribution | Does not measure within-genre quality |

Playlist evaluation is intrinsically holistic: users can rate a playlist differently from the average of its individual tracks, and coherence, familiarity, diversity and peak/end effects all matter. Recommendation support can also influence user choices even when a suggested item is not ultimately selected.

Instead of one edit-distance metric, decompose the published result into:

- **set retention**: Jaccard overlap between generated and published tracks;
- **deletion rate**;
- **manual-addition rate**;
- **ordering change**: Kendall distance on retained tracks;
- **artist and genre distribution change**.

This tells you whether the problem was item selection, missing coverage or sequence ordering. Offline reconstruction metrics alone are insufficient because a song absent from a historical playlist is not necessarily disliked, and accuracy-oriented offline evaluation can favour popularity.

## Prioritised implementation blueprint

### Ship the ranking corrections first

The first release should make no new model calls.

Implement:

score_i = sum_m w_m * g_m,i * z_m,i + P_i + 0.15 * B_i

with:

- fixed mode-specific weights;
- missing signal z=0, never proportional redistribution;
- confidence penalty P_i = -[0.10 + 0.25*q] * (1 - c_i);
- feedback prior initially zero until event volume exists;
- robust clipping of each z-score to approximately [-3, 3];
- Gumbel sampling, MMR, artist cap and genre calibration applied afterwards.

At the same time, log every exposure and action with full session context. Without exposure logging, negative and no-action evidence cannot be interpreted reliably.

### Add session anchors before long-term clustering

Implement independent pin heads and artist-pin heads. This is likely to produce a larger visible improvement than clustering because pins are direct evidence of what the current playlist is meant to be.

Use a soft maximum over pins and assign it 0.40 of pointwise relevance in pin-only sessions or 0.30 when both pins and typed intent exist.

Expected failure mode: pins may represent desired inclusion rather than desired homogeneity. Mitigate this by using a soft maximum and MMR rather than forcing every song near every pin.

### Cache multi-interest facet profiles

Build semantic and sonic clusters whenever the user's liked library materially changes. Store:

- cluster ID per song;
- centroid;
- medoid song ID;
- size;
- optional recency-weighted importance;
- silhouette and within-cluster dispersion.

If clustering is unstable, fall back to a single profile for that modality.

Expected failure modes include high-dimensional text clusters that reflect analysis wording rather than musical taste, and audio clusters dominated by tempo or loudness. Inspect medoids and standardise audio robustly. Keep the modalities separate so one defective clustering does not contaminate the other.

### Activate feedback conservatively

After approximately 100 explicit events for a user, enable song-level feedback. Enable artist effects only after entity-level guard-rails are met. Genre effects should remain very small.

Run an interleaving test between:

- ranking with feedback prior disabled;
- ranking with the bounded prior enabled.

Monitor whether the prior reduces repeated removals without reducing low-information exposure or artist diversity.

Expected failure mode: context leakage, where a removal made for one playlist suppresses the song globally. The short song-negative half-life, context logging and generalisation caps are the main protections.

### Canonicalise genre before asking an LLM

Adopt the AcousticBrainz 16-category map and convert existing Last.fm tags deterministically. Add artist shrinkage. Use the LLM only for unresolved items and retain abstention.

Do not increase the pointwise genre weight to compensate for missing labels. Genre pills should principally control output through the already-planned calibrated re-ranker.

Expected failure mode: coarse categories such as rock, pop and electronic absorb culturally specific or regional styles. Preserve the original Last.fm tags alongside canonical labels; the canonical layer is for control and calibration, not a replacement for descriptive tags.

### Pilot, rather than commit to, audio embeddings

Only after the preceding changes are measured should you test Discogs-EffNet embeddings on a representative subset. The go/no-go criterion should be a user-visible improvement in sonic neighbourhoods and interleaving outcomes, not benchmark reputation.

Do not deploy MERT, CLAP, graph neural networks, learned multi-interest routing, reinforcement learning or a trained cross-modal fusion model. They solve scale and supervision problems that this application does not possess, while adding new infrastructure, debugging surfaces and evaluation requirements.

The deliberately small-system solution is stronger: several cached taste heads, direct session anchors, fixed evidence semantics, cautious Bayesian feedback and high-sensitivity within-list experiments. It preserves obscure liked songs, responds to precise user steering, and remains understandable enough that every surprising recommendation can be traced to a handful of inspectable signals.
