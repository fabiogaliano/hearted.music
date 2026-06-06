# LLM Cost Tracking — Implementation Plan

## Context

Today the only LLM usage we persist is `song_analysis.tokens_used` /
`playlist_analysis.tokens_used` — a single **total** token count. Dollar cost is
never computed: `cost_cents` is hard-coded to `null` at every write site, and the
later-added `song_analysis` columns (`provider`, `input_tokens`, `output_tokens`,
`cost_usd`) exist in the schema but have **no write path** — every row leaves them
null. Distillation captures no tokens at all.

We want the **best per-call cost estimate obtainable from token usage**, for every
production LLM call: song analysis, playlist analysis, and annotation distillation.
A real per-call dollar amount is not available from Vertex or GCP billing (billing
only aggregates per SKU × day × project), so a token × price estimate is the
ceiling — and that's what this plan builds. Intended outcome: query "what did this
song/playlist/model/day cost" directly from our own DB.

### Decisions (confirmed with user)

- **Track all three** call sites: song, playlist, distillation.
- **Store the token split**, including cache-read and thinking (reasoning) tokens.
- **Pricing from a free, regularly-updated source** rather than hand-maintained
  numbers → use LiteLLM's `model_prices_and_context_window.json`.

---

## Key technical findings (already verified)

### AI SDK v6 usage mapping for Gemini/Vertex

`result.usage` (`LanguageModelUsage`, `node_modules/ai/dist/index.d.ts:267`) is
populated identically for the `google` and `google-vertex` providers — the Vertex
Gemini path reuses `convertGoogleGenerativeAIUsage`
(`@ai-sdk/google/dist/index.js:252`). The mapping from Gemini's `usageMetadata`:

| `result.usage` field | Source (`usageMetadata`) | Meaning |
| --- | --- | --- |
| `inputTokens` | `promptTokenCount` | **total** prompt tokens, **includes** cached |
| `inputTokenDetails.cacheReadTokens` | `cachedContentTokenCount` | cached prompt tokens read |
| `inputTokenDetails.noCacheTokens` | `promptTokenCount − cached` | billable non-cached input |
| `outputTokens` | `candidatesTokenCount + thoughtsTokenCount` | **total** output, **includes** thinking |
| `outputTokenDetails.textTokens` | `candidatesTokenCount` | visible output |
| `outputTokenDetails.reasoningTokens` | `thoughtsTokenCount` | thinking/reasoning |

Consequences for the cost formula:

- `outputTokens` **already includes** thinking tokens, and thinking is billed at
  the output rate — so `outputTokens × outputRate` is automatically correct. No
  separate reasoning term needed for cost.
- `inputTokens` **already includes** cached tokens, which are billed cheaper — so
  input cost must split: `(inputTokens − cacheRead) × inputRate + cacheRead × cacheReadRate`.

**Cost formula:**

```
nonCachedInput = inputTokens − cacheReadTokens
cost_usd = nonCachedInput   × inputRatePerToken
         + cacheReadTokens  × cacheReadRatePerToken   (fallback: inputRate)
         + outputTokens     × outputRatePerToken       (outputTokens already incl. thinking)
```

Return `null` (not `0`) when the model is unpriced, so "unknown price" is
distinguishable from "genuinely free."

### Current state (file map)

- `extractTokenUsage` (`src/lib/integrations/llm/service.ts:277`) only reads
  `inputTokens`/`outputTokens`/`totalTokens` and **discards** the cache/reasoning
  detail. `TokenUsage` = `{ prompt, completion, total }` (`service.ts:73`).
- `getCurrentModel()` returns the combined `"${provider}:${model}"`; the bare
  `provider`/`model` are private fields (`service.ts:131-132`), not surfaced.
- Write sites pass `cost_cents: null` and the combined model string:
  - `src/lib/domains/enrichment/content-analysis/song-analysis.ts:149`
  - `src/lib/domains/enrichment/content-analysis/playlist-analysis.ts:261`
- Inserts only forward 6 columns (`queries.ts:100`, `playlist-queries.ts`); the 4
  billing columns on `song_analysis` are never written.
- Distillation (`annotation-distillation.ts`): `google-vertex` /
  `gemini-2.5-flash-lite`, captures **no** tokens; writes to the content-hash-keyed
  cache table `annotation_distillation` (no token/cost columns).
- **No price table or cost formula exists anywhere** in `src/` or `scripts/`.

### Pricing source

LiteLLM `model_prices_and_context_window.json` — MIT-licensed, community-maintained,
updated continuously, covers Vertex Gemini with `input_cost_per_token`,
`output_cost_per_token`, and `cache_read_input_token_cost` (per-token, e.g.
`3e-7` = $0.30/M). Raw URL:

```
https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json
```

Current reference rates (per 1M tokens, on-demand, Vertex, 2026-06):

| Model | input | cached input | output |
| --- | --- | --- | --- |
| `gemini-2.5-flash` | $0.30 | ~$0.03 (10% of input) | $2.50 |
| `gemini-2.5-flash-lite` | $0.10 | ~$0.025 | $0.40 |

---

## Architecture

Three pieces, each in its natural layer:

### 1. Unified `llm_usage` ledger (single source of truth)

One row per **actual** LLM call, for every call site. Chosen over per-row columns
because:

- Distillation writes to a **deduplicated, content-hash-keyed cache**
  (`annotation_distillation`). A cache hit incurs **no** call and **no** cost; cost
  can't be attributed per-song there. A ledger records real call-time spend only
  when a generation actually happens.
- `playlist_analysis` has none of the cost columns, and the distillation cache table
  is a poor home for cost — a ledger avoids three different schemas + three write
  shapes in favor of one uniform row.
- One code path computes cost once and inserts once; future providers/call sites
  (e.g. DeepInfra embeddings) extend it for free.

**Migration:** `supabase/migrations/<timestamp>_create_llm_usage.sql` (generate the
timestamp with `supabase migration new llm_usage`; follow the existing
`YYYYMMDDHHMMSS_*.sql` convention).

```sql
CREATE TABLE llm_usage (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  function_id   TEXT NOT NULL,                       -- call site, e.g. 'song-analysis'
  provider      TEXT NOT NULL,                       -- 'google-vertex'
  model         TEXT NOT NULL,                       -- bare model, 'gemini-2.5-flash'
  song_id       UUID REFERENCES song(id) ON DELETE SET NULL,
  playlist_id   UUID REFERENCES playlist(id) ON DELETE SET NULL,
  content_hash  TEXT,                                -- distillation entity key
  input_tokens      INTEGER NOT NULL,                -- total prompt, incl. cached
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens     INTEGER NOT NULL,                -- total output, incl. thinking
  reasoning_tokens  INTEGER NOT NULL DEFAULT 0,      -- thinking subset (diagnostic)
  cost_usd      NUMERIC(12, 8),                      -- null when model unpriced
  price_version TEXT,                                -- snapshot id used for pricing
  prompt_version TEXT
);
CREATE INDEX llm_usage_created_at_idx ON llm_usage (created_at DESC);
CREATE INDEX llm_usage_model_idx      ON llm_usage (model);
CREATE INDEX llm_usage_song_idx       ON llm_usage (song_id)     WHERE song_id IS NOT NULL;
CREATE INDEX llm_usage_playlist_idx   ON llm_usage (playlist_id) WHERE playlist_id IS NOT NULL;
```

Exactly one of `song_id` / `playlist_id` / `content_hash` is set per row (none for
ad-hoc/script calls, which won't write here anyway). Typed nullable FKs (over a
generic `entity_id`) give clean joins + referential integrity for the two
uuid-keyed entities.

> Regenerate `src/lib/data/database.types.ts` after the migration
> (`supabase gen types ...` per the project's existing flow).

### 2. Pricing in the LLM integration layer

New, no-barrel-export modules under `src/lib/integrations/llm/`:

- **`model-prices.generated.json`** — a *pinned* subset of the LiteLLM JSON
  (only the models we use + a `_synced_at` stamp). Runtime reads this, so prod has
  **no network dependency** and is deterministic/testable.
- **`pricing.ts`**:
  - `getModelPrice(provider, model)` → `{ inputPerToken, cacheReadPerToken?, outputPerToken } | null`.
    Normalizes the bare model id, tries the direct key then the `vertex_ai/<model>`
    key, and falls back to a small hard-coded `FALLBACK_PRICES` map for our two
    Gemini models so cost is never silently null on a key miss.
  - `computeCostUsd(tokens, provider, model)` → `number | null` implementing the
    formula above.
- **`scripts/sync-model-prices.ts`** — fetches the LiteLLM JSON, extracts the keys
  we care about, writes `model-prices.generated.json`. Run with
  `bun run scripts/sync-model-prices.ts`; refresh on a schedule or in CI. (This is
  the "free service, updated regularly" source, vendored for safety.)

### 3. Service enrichment + domain-layer persistence

Keep `LlmService` **DB-free** (so `scripts/voice-audit/*` can keep using it without
a database) — it only *computes* cost; the *domain* layer persists.

- **`service.ts`**:
  - Widen `extractTokenUsage` to also read `usage.inputTokenDetails?.cacheReadTokens`
    and `usage.outputTokenDetails?.reasoningTokens`. Extend `TokenUsage` to
    `{ prompt, completion, total, cacheReadTokens, reasoningTokens }` (keeps the
    existing `prompt`/`completion`/`total` names → existing `tokens?.total` readers
    keep working).
  - Surface `provider` and bare `modelId` on `TextGenerationResult` /
    `ObjectGenerationResult` (keep `model` = combined string for the existing
    `song_analysis.model` column), and attach `costUsd = computeCostUsd(...)`.
- **`llm-usage-queries.ts`** (new, in the content-analysis domain dir):
  `recordLlmUsage(data): Promise<Result<void, DbError>>` inserting one ledger row.
- **Call sites** invoke `recordLlmUsage` after a successful generation:
  - `song-analysis.ts` → `{ song_id, function_id: 'song-analysis', ... }`
  - `playlist-analysis.ts` → `{ playlist_id, function_id: 'playlist-analysis', ... }`
  - `annotation-distillation.ts` → one row per **generated** entry (cache hits make
    no call → no row), `{ content_hash, function_id: 'annotation-distillation', ... }`.

**Best-effort logging:** cost persistence must never break analysis. Each
`recordLlmUsage` call is awaited but its error is logged-and-swallowed (the
functions already return `Result`, so just don't propagate). A failed ledger insert
must not fail the song/playlist/distillation.

---

## Implementation steps

1. **Pricing source**: add `scripts/sync-model-prices.ts`; run it to generate
   `src/lib/integrations/llm/model-prices.generated.json`.
2. **Pricing logic**: add `src/lib/integrations/llm/pricing.ts`
   (`getModelPrice`, `computeCostUsd`, `FALLBACK_PRICES`) + `pricing.test.ts`.
3. **Service**: widen `extractTokenUsage` + `TokenUsage`; surface
   `provider`/`modelId`/`costUsd` on the two result types (`service.ts`).
4. **Migration**: create `llm_usage`; regenerate `database.types.ts`.
5. **Query helper**: add `llm-usage-queries.ts` with `recordLlmUsage`.
6. **Wire call sites**: `song-analysis.ts`, `playlist-analysis.ts`,
   `annotation-distillation.ts` (capture tokens — it currently discards them).
7. **Tests**: pricing math, service mapping, and call-site `recordLlmUsage`
   assertions (see below).

The existing, never-populated `song_analysis` cost columns (`provider`,
`input_tokens`, `output_tokens`, `cost_usd`, `cost_cents`) are **superseded** by the
ledger — leave them for now; a follow-up cleanup migration can drop them once the
ledger is the sole consumer (out of scope here).

---

## Tests

- `pricing.test.ts`: `getModelPrice` returns expected rates for both Gemini models +
  `null` for unknown; `computeCostUsd` with hand-computed token counts asserts an
  exact dollar value — including (a) the cache split, (b) thinking baked into
  `outputTokens`, (c) unknown model → `null`, (d) cacheRead rate fallback to input.
- `service.test.ts` (new/extended): `extractTokenUsage` maps
  `inputTokenDetails.cacheReadTokens` + `outputTokenDetails.reasoningTokens`;
  result carries `provider`, `modelId`, `costUsd`.
- Update `__tests__/song-analysis*.test.ts` and
  `__tests__/annotation-distillation.test.ts`: mock `recordLlmUsage`, assert it's
  called once per generated item with the right shape; assert a ledger-insert
  failure does **not** fail the analysis.
- Run via `bun run test` (Vitest).

## Verification (end-to-end)

1. `bun run scripts/sync-model-prices.ts` → confirm the generated JSON has non-zero
   `input_cost_per_token` / `output_cost_per_token` / `cache_read_input_token_cost`
   for both Gemini models.
2. `bun run test` → all green.
3. Run one real analysis (the gated `analysis-pipeline-full-flow.integration.test.ts`
   with `FULL_FLOW_TEST=true`, or a single `analyzeSong`), then via the
   `supabase-local` skill / psql:
   ```sql
   SELECT function_id, model, input_tokens, cache_read_tokens,
          output_tokens, reasoning_tokens, cost_usd
   FROM llm_usage ORDER BY created_at DESC LIMIT 10;
   ```
4. Hand-check one row: `cost_usd ≈ (input−cacheRead)/1e6·inputRate +
   cacheRead/1e6·cacheRate + output/1e6·outputRate`.

---

## Caveats & out of scope

- **Estimate, not the invoice.** This is list-price × tokens. The real GCP charge
  differs by Cloud credits, committed-use discounts, and Vertex rounding. For
  actual spend, reconcile against the BigQuery billing export (out of scope).
- **Long-context tier** (>200K-token prompts get higher Gemini rates) is **not**
  modeled — our prompts (lyrics + annotations) are far below that. Revisit if
  prompts grow.
- **Cache storage cost** (Gemini explicit context caching charges per-token-hour
  storage) is not modeled — we only see cache *reads*, and implicit caching has no
  storage charge.
- **Price freshness.** LiteLLM rates can lag official changes by days, and the
  pinned snapshot adds its own lag — the refresh cadence of `sync-model-prices.ts`
  is the accuracy knob. `price_version` on each row records which snapshot priced it.
- **DeepInfra embeddings** are not tracked here; the ledger is shaped to absorb them
  later.

## Sources

- [LiteLLM `model_prices_and_context_window.json`](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json)
- [Vertex AI generative AI pricing](https://cloud.google.com/vertex-ai/generative-ai/pricing)
- [Gemini 2.5 Flash (Vertex)](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash) · [Gemini 2.5 Flash-Lite (Vertex)](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash-lite)
