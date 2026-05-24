# Auth E2E suite

End-to-end coverage for email/password auth (and its coexistence with Google),
run against a **live local stack**. Deliberately kept out of `bun run test`
(Vitest) because it needs a running server + Postgres; it is **not** wired into
CI by design.

## What it covers

**API + DB** (`/api/auth/*` + direct Postgres assertions)

- sign-up issues a session (`autoSignIn`) and creates an unverified user
- password stored as a scrypt hash (never plaintext); `refresh_token_expires_at` column present
- app `account` row created by the `user.create.after` hook
- unverified user can sign in (soft verification)
- wrong password / unknown email both rejected with the same generic 401
- password reset rotates the hash, **revokes all sessions**, single-use token, old pw fails / new pw works
- email verification flips `email_verified` on a valid token; bad token redirects with `?error=`

**Browser UI** (Playwright, real Chromium)

- login renders; credentials form hidden behind the collapsible
- expand reveals email/password, hides Google, autofocuses email
- collapse restores the Google view
- sign-in / sign-up navigate out of `/login`; new sign-ups show the unverified banner
- forgot-password routes and shows the confirmation screen

## Prerequisites

```bash
supabase start      # local Postgres on 127.0.0.1:54322
bun run dev         # app on http://127.0.0.1:5173
```

## Run

```bash
bun run test:e2e
```

Override the target with `E2E_BASE_URL` if the app runs elsewhere. The suite
creates users matching `e2e-%@hearted.test` and **cleans them up on exit**
(even on failure). Exit code is non-zero if any check fails.

## Notes

- Uses the bare `playwright` library (no `@playwright/test` runner) plus a small
  assertion collector — same shape it was prototyped in.
- The UI helpers retry the collapsible click to ride out the SSR hydration race
  (handlers attach a beat after first paint). Forgot-password submits once,
  because its button disables while submitting.
