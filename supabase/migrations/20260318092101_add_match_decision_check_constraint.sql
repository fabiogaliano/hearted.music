ALTER TABLE match_decision
  ADD CONSTRAINT valid_decision CHECK (decision IN ('added', 'dismissed'));
