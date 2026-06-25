-- RPC for idempotent song queue item insertion.
--
-- PostgREST cannot target partial unique indexes via onConflict column lists
-- because it generates ON CONFLICT (session_id, song_id) without a WHERE
-- clause; Postgres cannot match the partial index
-- idx_match_review_queue_item_session_song_subject (WHERE orientation = 'song')
-- without the predicate, so the upsert throws. This RPC includes the WHERE
-- clause explicitly so the partial index is matched.
create or replace function insert_queue_song_items(
  p_session_id uuid,
  p_account_id uuid,
  p_items jsonb
)
returns void
language plpgsql
security definer
as $$
begin
  insert into match_review_queue_item (
    session_id,
    account_id,
    song_id,
    source_snapshot_id,
    position,
    orientation,
    state,
    source_fit_score,
    was_new_at_enqueue
  )
  select
    p_session_id,
    p_account_id,
    (item->>'song_id')::uuid,
    (item->>'source_snapshot_id')::uuid,
    (item->>'position')::integer,
    'song',
    'pending',
    (item->>'source_fit_score')::numeric,
    coalesce((item->>'was_new_at_enqueue')::boolean, false)
  from jsonb_array_elements(p_items) as item
  on conflict (session_id, song_id) where orientation = 'song' do nothing;
end;
$$;
