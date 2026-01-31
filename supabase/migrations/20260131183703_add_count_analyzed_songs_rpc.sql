-- Counts how many of a user's liked songs have analysis records.
-- Uses JOIN instead of fetching all IDs to avoid large IN clauses.
create or replace function count_analyzed_songs_for_account(p_account_id uuid)
returns bigint
language sql
stable
as $$
  select count(distinct sa.song_id)
  from song_analysis sa
  inner join liked_song ls on ls.song_id = sa.song_id
  where ls.account_id = p_account_id
    and ls.unliked_at is null;
$$;
