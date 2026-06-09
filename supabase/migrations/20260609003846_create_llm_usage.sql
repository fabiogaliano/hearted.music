-- Unified per-call ledger of production LLM spend (token × list-price estimate).
--
-- One row per ACTUAL LLM call, across every call site: song-analysis generation,
-- the song voice rewrite pass (song-rewrite), playlist-analysis, and
-- annotation-distillation. Chosen over per-row columns on the analysis tables
-- because distillation is a content-hash-keyed cache (a cache hit makes no call and
-- has no cost) and playlist_analysis carries no cost columns at all — a ledger
-- records real call-time spend in one uniform shape and absorbs future call sites.
--
-- cost_usd is a list-price ESTIMATE, not the GCP invoice (no credits / committed-use
-- discounts / Vertex rounding). NULL cost_usd = model was unpriced, kept distinct
-- from 0. price_version records which sync-model-prices snapshot priced the row.
--
-- Worker-written via the service role (BYPASSRLS); deny-all RLS like song_lyrics /
-- annotation_distillation so anon/authenticated cannot read spend data.

CREATE TABLE llm_usage (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  function_id       TEXT NOT NULL,                                       -- call site, e.g. 'song-analysis'
  provider          TEXT NOT NULL,                                       -- 'google-vertex'
  model             TEXT NOT NULL,                                       -- bare model, 'gemini-2.5-flash'
  -- Exactly one of these three identifies the entity the call was for (none for
  -- ad-hoc/script calls, which do not write here). Typed nullable FKs give clean
  -- joins + referential integrity for the two uuid-keyed entities.
  song_id           UUID REFERENCES song(id)     ON DELETE SET NULL,
  playlist_id       UUID REFERENCES playlist(id) ON DELETE SET NULL,
  content_hash      TEXT,                                                -- distillation entity key
  input_tokens      INTEGER NOT NULL,                                    -- total prompt, incl. cached
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens     INTEGER NOT NULL,                                    -- total output, incl. thinking
  reasoning_tokens  INTEGER NOT NULL DEFAULT 0,                          -- thinking subset (diagnostic)
  cost_usd          NUMERIC(12, 8),                                      -- NULL when model unpriced
  price_version     TEXT,                                                -- price snapshot id used
  prompt_version    TEXT
);

CREATE INDEX llm_usage_created_at_idx ON llm_usage (created_at DESC);
CREATE INDEX llm_usage_model_idx      ON llm_usage (model);
CREATE INDEX llm_usage_song_idx       ON llm_usage (song_id)     WHERE song_id IS NOT NULL;
CREATE INDEX llm_usage_playlist_idx   ON llm_usage (playlist_id) WHERE playlist_id IS NOT NULL;

ALTER TABLE llm_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "llm_usage_deny_all" ON llm_usage FOR ALL USING (false);

COMMENT ON TABLE llm_usage IS
  'Per-call LLM spend ledger (token × list-price estimate); one row per actual call across all call sites';
COMMENT ON COLUMN llm_usage.cost_usd IS
  'List-price × token estimate, not the GCP invoice; NULL = model unpriced (distinct from 0)';
COMMENT ON COLUMN llm_usage.input_tokens IS
  'Total prompt tokens INCLUDING the cache_read_tokens subset (Gemini reports it inclusive)';
COMMENT ON COLUMN llm_usage.output_tokens IS
  'Total output tokens INCLUDING the reasoning_tokens subset (Gemini folds thinking into output)';
COMMENT ON COLUMN llm_usage.price_version IS
  'Which sync-model-prices snapshot (model-prices.generated.json _synced_at) priced this row';
