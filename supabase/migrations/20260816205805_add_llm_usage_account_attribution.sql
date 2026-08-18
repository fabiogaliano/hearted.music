-- Future LLM calls retain their requesting account for product-audience cost reporting.
ALTER TABLE llm_usage
  ADD COLUMN account_id UUID REFERENCES account(id) ON DELETE SET NULL;

CREATE INDEX llm_usage_account_id_idx
  ON llm_usage (account_id)
  WHERE account_id IS NOT NULL;
