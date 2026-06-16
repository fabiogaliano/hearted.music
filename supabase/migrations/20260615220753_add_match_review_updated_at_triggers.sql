-- Without these triggers, updated_at stays frozen at insert time regardless of
-- subsequent UPDATEs — the column only advances if the DB enforces it.

DROP TRIGGER IF EXISTS match_review_session_updated_at ON match_review_session;
CREATE TRIGGER match_review_session_updated_at
  BEFORE UPDATE ON match_review_session
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS match_review_queue_item_updated_at ON match_review_queue_item;
CREATE TRIGGER match_review_queue_item_updated_at
  BEFORE UPDATE ON match_review_queue_item
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
