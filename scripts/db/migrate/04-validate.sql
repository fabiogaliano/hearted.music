-- Post-restore validation. Run against BOTH prod and target and diff the output;
-- the numbers must match (modulo rows written to prod after the dump started).

\echo '== row counts (key tables) =='
select 'match_result'   as t, count(*) from match_result
union all select 'match_snapshot', count(*) from match_snapshot
union all select 'song',           count(*) from song
union all select 'song_embedding', count(*) from song_embedding
union all select 'liked_song',     count(*) from liked_song
union all select 'playlist',       count(*) from playlist
union all select 'job',            count(*) from job
union all select '"user"',         count(*) from "user"      -- better-auth
union all select 'account',        count(*) from account
order by t;

\echo '== extensions present =='
select extname, extnamespace::regnamespace as schema
from pg_extension where extname in ('vector','pg_trgm') order by extname;

\echo '== vector / trgm indexes present =='
select indexname from pg_indexes
where schemaname='public'
  and (indexdef ilike '%hnsw%' or indexdef ilike '%gin_trgm_ops%')
order by indexname;

\echo '== total db size =='
select pg_size_pretty(pg_database_size(current_database())) as db_size;
