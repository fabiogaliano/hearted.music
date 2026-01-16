# Change: Setup Supabase Foundation

## Why

The application requires a backend database to store user accounts, liked songs, playlists, job progress, and match results. Supabase provides PostgreSQL with built-in Row Level Security (RLS), auth integration, and a JavaScript client that works seamlessly with TanStack Start on Cloudflare Workers.

This is **Phase 0** of the migration-v2 roadmap - the foundational infrastructure that all subsequent phases depend on.

## Approach

**Fresh start with Supabase Cloud** - The existing v0 local Supabase project will be left untouched. This v1_hearted codebase will connect to a new Supabase Cloud project (free tier) for development. Local Supabase remains optional for offline development.

## What Changes

- Add `@supabase/supabase-js` dependency
- Configure environment variables for Supabase URL and anon key
- Create typed Supabase client module (`src/lib/data/client.ts`)
- Add `.env.example` template for required variables
- Document Supabase Cloud project setup

## Impact

- Affected specs: NEW `supabase-client` capability
- Affected code:
  - `src/env.ts` - Add Supabase environment variables
  - `src/lib/data/client.ts` - New Supabase client module
  - `src/lib/data/database.types.ts` - TypeScript types stub
  - `package.json` - Add dependency
  - `.env.example` - Document required variables

## Dependencies

- None (this is Phase 0)

## Blocked By

- Supabase Cloud project must be created at [supabase.com](https://supabase.com)

## Enables

- Phase 1: Schema DDL
- Phase 2: Extensions & Types
- Phase 3: Query Modules
- All subsequent database operations

## Notes

- v0 local Supabase project is **not affected** - leave it as-is for reference
- Supabase Cloud free tier includes: 500MB database, 1GB file storage, 50K monthly active users
- Keep-alive ping prevents free tier project from pausing (Decision #052)
