# Tasks: Setup Supabase Foundation

## 0. Supabase Cloud Project Setup (Manual)

- [ ] 0.1 Create new project at [supabase.com](https://supabase.com) (free tier)
- [ ] 0.2 Copy project URL and anon key from Project Settings > API
- [ ] 0.3 Create `.env` file with credentials (from `.env.example`)

## 1. Install Dependencies

- [ ] 1.1 Install `@supabase/supabase-js` package

## 2. Environment Configuration

- [ ] 2.1 Add Supabase environment variables to `src/env.ts` using `@t3-oss/env-core`
- [ ] 2.2 Create `.env.example` with placeholder values and documentation
- [ ] 2.3 Verify `.gitignore` includes `.env` (already present in template)

## 3. Create Supabase Client Module

- [ ] 3.1 Create `src/lib/data/` directory
- [ ] 3.2 Create `src/lib/data/client.ts` with typed client factory
- [ ] 3.3 Create `src/lib/data/database.types.ts` stub for future schema types

## 4. Validation

- [ ] 4.1 Verify TypeScript compilation passes (`bun run build` or `tsc --noEmit`)
- [ ] 4.2 Verify Biome lint/format passes (`bun run check`)
- [ ] 4.3 Test client initialization in dev server (manual smoke test)

## 5. Optional: Local Supabase Setup

- [ ] 5.1 Add `supabase/` to `.gitignore`
- [ ] 5.2 Document local setup in README (for offline development)

---

## Notes

- **v0 local Supabase is untouched** - this is a fresh start for v1_hearted
- Database schema (tables, RLS policies) will be added in Phase 1
- This phase focuses only on client setup and environment configuration
- Free tier project auto-pauses after 1 week of inactivity (add keep-alive later)
