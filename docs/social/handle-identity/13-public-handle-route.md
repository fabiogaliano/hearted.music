# Task 13 — Public `/@handle` route

**Plan:** §9.3 · **Recommended order:** step 13 · **Status:** [x]

## Goal

Add a minimal public `/@handle` coming-soon route so the namespace exists in v0,
live **only** after the owner completes onboarding. The route file never imports
the admin-client account query directly — it goes through a public server function.

## Checklist

### Domain query — `src/lib/domains/library/accounts/queries.ts` (§9.3)

- [ ] Export `interface PublicHandleIdentity { handle: string; imageUrl: string | null }`
- [ ] `getPublicHandleIdentityByHandle(handle): Promise<Result<PublicHandleIdentity | null, DbError>>`
- [ ] Use the admin client (`account` is deny-all under RLS); lowercase-normalize the handle before lookup
- [ ] Query `account` **inner-joined** to `user_preferences`; require matching `account.handle` **and** `user_preferences.onboarding_completed_at IS NOT NULL`
- [ ] Select only `handle` and `image_url`; implement as an exact `maybeSingle()`-style 0-or-1 contract (not array-then-first)
- [ ] Map `image_url` → `imageUrl` here (DB→app mapping belongs in the query helper)
- [ ] Return `null` only for no live public handle (incl. claimed-but-not-complete); on multiplicity/other error return `Result.err(...)` — do **not** collapse to `null`

### Public server fn — `src/lib/server/public-handle.functions.ts` (§9.3)

- [ ] `getPublicHandleIdentity = createServerFn({ method: "GET" })` with `inputValidator(z.object({ handle: z.string() }))`
- [ ] **No** auth middleware
- [ ] Lowercase only — do **not** trim/strip `@`/collapse separators/repair malformed strings
- [ ] Call `getPublicHandleIdentityByHandle(...)`: `err` → throw (error boundary), `ok(null)` → return `null`, `ok(identity)` → return it
- [ ] This is the only boundary the route loader calls

### Route — `src/routes/@{$handle}.tsx` (§9.3)

- [ ] `createFileRoute('/@{$handle}')` (TanStack prefix path-param: `@` literal outside braces, `{$handle}` in-segment → `/@fabio` ⇒ `params.handle = "fabio"`)
- [ ] Public, no auth; loader lowercases `params.handle`
- [ ] If `params.handle !== params.handle.toLowerCase()` → redirect to `/@${lowercase}` before lookup
- [ ] Lowercase-only canonicalization; do **not** trim/format-validate. Malformed-but-lowercase falls through to `notFound()`
- [ ] Resolve via `getPublicHandleIdentity({ data: { handle: canonicalHandle } })`
- [ ] `null` → `throw notFound()` (root not-found UI); thrown/operational failure → rethrow (root error UI)
- [ ] Existing + completed → render coming-soon page (do **not** redirect to Settings)
- [ ] Title `@${identity.handle} — Public profile coming soon • hearted.`; **no** v0 `noindex` override
- [ ] Route file must **not** import the admin-client query directly

### Page — `src/features/public-handle/PublicHandleComingSoonPage.tsx` (§9.3)

- [ ] Props exactly `{ identity: PublicHandleIdentity }`
- [ ] `UserAvatar` as `name={identity.handle}` / `imageUrl={identity.imageUrl}`
- [ ] Primary line `@${identity.handle}`; heading `Public profile coming soon.`; body `More public Hearted features are on the way.`; CTA `Back to hearted.` → `/`
- [ ] Do **not** render `display_name` or a second provider-name line
- [ ] Hard exclusions: no liked-song/playlist/jukebox data, no edit controls, no private fields beyond `handle` + Spotify `image_url`

## Dependencies

Task 02 (`account.handle`). Self-contained otherwise.

## Related tests

Task 15 → §14.8 (public `@handle` route tests).
