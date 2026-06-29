-- Recreate the single private `sync-payloads` bucket on the target's storage
-- schema. Its objects are transient ~20 MB extension-sync blobs, reproducible by
-- re-sync, so none are migrated — only the bucket definition the app expects.
--
-- 50 MiB file-size limit mirrors supabase/config.toml; private (no public read).

insert into storage.buckets (id, name, public, file_size_limit)
values ('sync-payloads', 'sync-payloads', false, 52428800)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit;
