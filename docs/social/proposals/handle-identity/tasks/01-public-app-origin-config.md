# Task 01 — Public app-origin config

**Plan:** §10 (incl. §10.1–§10.4) · **Recommended order:** step 1 · **Status:** [x]

## Goal

Introduce a single env-backed canonical origin (`VITE_PUBLIC_APP_ORIGIN`) for
externally surfaced public links, plus one cross-runtime helper module that owns
URL assembly. This must land first because `ClaimHandleStep`'s live preview and
the email consumers both depend on the shared helper.

`publicAppOrigin` deliberately comes from validated public config rather than
onboarding loader data, so the same helper works in client and server contexts
without reaching through the server env layer.

## Checklist

- [ ] Add `VITE_PUBLIC_APP_ORIGIN` (prod `https://hearted.music`, local `http://127.0.0.1:5173`) to env files: `.env`, `.env.local`, `.env.example`, `.env.cloud`
- [ ] Add it to `src/env.public.ts`'s existing validated `clientEnv` object as a **required, URL-validated** value (not optional best-effort)
- [ ] Add to `src/env.ts` broader validation only if repo conventions require it (the public helper must still read from `env.public.ts`)
- [ ] Update any env docs / README snippets that enumerate required vars
- [ ] Create `src/lib/config/public-app-origin.ts` exporting:
  - [ ] `getPublicAppOrigin(): string` — reads `clientEnv.VITE_PUBLIC_APP_ORIGIN`, trims exactly one trailing slash
  - [ ] `buildPublicHandleUrl(handle: string): string` — composes canonical origin + `/@${handle}`, assumes a canonical bare handle
- [ ] Repoint `src/lib/email/waitlist-confirmation.ts` footer link to the shared helper (drop hardcoded `https://hearted.music`)
- [ ] Repoint `src/lib/email/welcome.ts` body CTA + footer links to the shared helper

## Files touched

`src/env.public.ts`, `src/env.ts`, `src/lib/config/public-app-origin.ts` (new),
`src/lib/email/waitlist-confirmation.ts`, `src/lib/email/welcome.ts`, env files.

## Guardrails (§10.4 — do NOT use this env for)

- same-origin extension handshake flows that correctly use `window.location.origin`
- already-generated auth/verification/password-reset URLs
- non-URL brand strings (e.g. support email addresses)

No separate client-only vs server-only URL builder — one cross-runtime module only.

## Dependencies

None. This is the first task.

## Related tests

Covered indirectly via `ClaimHandleStep` preview tests (Task 15 → §14.6) and the
trailing-slash edge case (§12, `VITE_PUBLIC_APP_ORIGIN has a trailing slash`).
