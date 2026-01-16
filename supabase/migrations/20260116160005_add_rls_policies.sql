-- Add RLS policies for all tables
-- Note: service_role key bypasses RLS, these policies secure anon/authenticated access

-- Account policies (deny direct access, managed via service_role)
CREATE POLICY "account_deny_all" ON account FOR ALL USING (false);

-- Auth token policies (deny direct access, managed via service_role)
CREATE POLICY "auth_token_deny_all" ON auth_token FOR ALL USING (false);

-- Song policies (deny direct access, managed via service_role)
CREATE POLICY "song_deny_all" ON song FOR ALL USING (false);

-- Playlist policies (deny direct access, managed via service_role)
CREATE POLICY "playlist_deny_all" ON playlist FOR ALL USING (false);

-- Liked song policies (deny direct access, managed via service_role)
CREATE POLICY "liked_song_deny_all" ON liked_song FOR ALL USING (false);

-- Playlist song policies (deny direct access, managed via service_role)
CREATE POLICY "playlist_song_deny_all" ON playlist_song FOR ALL USING (false);

-- Job policies (deny direct access, managed via service_role)
CREATE POLICY "job_deny_all" ON job FOR ALL USING (false);
