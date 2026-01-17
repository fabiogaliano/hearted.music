-- Add RLS policies for analysis schema tables
-- Note: service_role key bypasses RLS, these policies secure anon/authenticated access

-- Song extension policies (deny direct access, managed via service_role)
CREATE POLICY "song_audio_feature_deny_all" ON song_audio_feature FOR ALL USING (false);
CREATE POLICY "song_analysis_deny_all" ON song_analysis FOR ALL USING (false);
CREATE POLICY "song_embedding_deny_all" ON song_embedding FOR ALL USING (false);

-- Playlist extension policies (deny direct access, managed via service_role)
CREATE POLICY "playlist_analysis_deny_all" ON playlist_analysis FOR ALL USING (false);
CREATE POLICY "playlist_profile_deny_all" ON playlist_profile FOR ALL USING (false);

-- Job extension policies (deny direct access, managed via service_role)
CREATE POLICY "job_failure_deny_all" ON job_failure FOR ALL USING (false);

-- Matching policies (deny direct access, managed via service_role)
CREATE POLICY "match_context_deny_all" ON match_context FOR ALL USING (false);
CREATE POLICY "match_result_deny_all" ON match_result FOR ALL USING (false);

-- User tables policies (deny direct access, managed via service_role)
CREATE POLICY "item_status_deny_all" ON item_status FOR ALL USING (false);
CREATE POLICY "user_preferences_deny_all" ON user_preferences FOR ALL USING (false);
