-- Remove action_type and actioned_at from item_status
-- Matching actions now live in match_decision table
-- item_status becomes a pure pipeline processing tracker + newness flag

ALTER TABLE item_status DROP COLUMN IF EXISTS action_type;
ALTER TABLE item_status DROP COLUMN IF EXISTS actioned_at;
