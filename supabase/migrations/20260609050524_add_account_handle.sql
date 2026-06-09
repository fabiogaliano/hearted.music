ALTER TABLE account ADD COLUMN handle TEXT;

CREATE UNIQUE INDEX account_handle_key
  ON account (handle)
  WHERE handle IS NOT NULL;

ALTER TABLE account
  ADD CONSTRAINT account_handle_format_check
  CHECK (
    handle IS NULL OR (
      handle = btrim(handle)
      AND handle = lower(handle)
      AND char_length(handle) BETWEEN 1 AND 30
      AND handle ~ '^[a-z0-9._]+$'
      AND handle !~ '^\.'
      AND handle !~ '\.$'
      AND handle !~ '\.\.'
    )
  );
