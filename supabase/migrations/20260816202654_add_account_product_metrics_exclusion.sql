-- Operator/test accounts remain fully functional but are omitted from product-audience reporting.
ALTER TABLE account
  ADD COLUMN exclude_from_product_metrics BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX account_product_metrics_included_idx
  ON account (id)
  WHERE exclude_from_product_metrics = false;
