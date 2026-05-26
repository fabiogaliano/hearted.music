-- Four tables had RLS enabled but no explicit policy, relying on Postgres's
-- implicit deny-all. App access goes through the service_role (BYPASSRLS), so
-- this only affects anon/authenticated roles — which were already denied. These
-- explicit policies make the intent legible and match every other table's
-- convention, so an auditor scanning pg_policies sees "deliberate deny" rather
-- than "policy forgotten".

-- Match decision policies (deny direct access, managed via service_role)
CREATE POLICY "match_decision_deny_all" ON match_decision FOR ALL USING (false);

-- Walkthrough match preview policies (deny direct access, managed via service_role)
CREATE POLICY "walkthrough_match_preview_deny_all" ON walkthrough_match_preview FOR ALL USING (false);

-- Library processing state policies (deny direct access, managed via service_role)
CREATE POLICY "library_processing_state_deny_all" ON library_processing_state FOR ALL USING (false);

-- Song lyrics policies (deny direct access, managed via service_role)
CREATE POLICY "song_lyrics_deny_all" ON song_lyrics FOR ALL USING (false);
