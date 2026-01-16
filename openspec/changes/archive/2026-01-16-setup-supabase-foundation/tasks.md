# Tasks: Setup Supabase Foundation

## 0. Supabase Cloud Project Setup (Manual)

- [x] 0.1 Create new project at [supabase.com](https://supabase.com) (free tier)
- [x] 0.2 Copy project URL and anon key from Project Settings > API
- [x] 0.3 Create `.env` file with credentials (from `.env.example`)

## 1. Install Dependencies

- [x] 1.1 Install `@supabase/supabase-js` package

## 2. Environment Configuration

- [x] 2.1 Add Supabase environment variables to `src/env.ts` using `@t3-oss/env-core`
- [x] 2.2 Create `.env.example` with placeholder values and documentation
- [x] 2.3 Verify `.gitignore` includes `.env` (already present in template)

## 3. Create Supabase Client Module

- [x] 3.1 Create `src/lib/data/` directory
- [x] 3.2 Create `src/lib/data/client.ts` with typed client factory
- [x] 3.3 Create `src/lib/data/database.types.ts` stub for future schema types

## 4. Validation

- [x] 4.1 Verify TypeScript compilation passes (`bun run build` or `tsc --noEmit`)
- [x] 4.2 Verify Biome lint/format passes (`bun run check`)
- [x] 4.3 Test client initialization (verified via bun script)

## 5. Optional: Local Supabase Setup

- [x] 5.1 Add `supabase/` to `.gitignore`
- [x] 5.2 Initialize local Supabase (`supabase init`)
- [x] 5.3 Start local containers (`supabase start`)
- [x] 5.4 Create `.env.local` and `.env.cloud` for easy switching
- [x] 5.5 Link local to cloud project (`supabase link`)

---

## Completion Notes

**Status: ✅ COMPLETE**

All required tasks completed plus optional local setup:
- Cloud project created and configured
- Local Supabase running on `127.0.0.1:54321`
- Projects linked for migration workflow
- Environment switching via `.env` / `.env.local` / `.env.cloud`

Next phase: Database schema design or Spotify OAuth
