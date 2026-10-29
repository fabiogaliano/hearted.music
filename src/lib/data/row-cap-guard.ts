/**
 * PostgREST's max_rows (supabase/config.toml; prod matches). A read past it
 * comes back cut to this many rows, with a 200 and no error.
 */
export const POSTGREST_MAX_ROWS = 1_000;
