# Task 03 — Handle domain rules & modules

**Plan:** §5 (§5.1–§5.7) · **Recommended order:** step 5 · **Status:** [x]

## Goal

Build the shared handle rules as small domain modules under
`src/lib/domains/library/accounts/`. `validateHandleFormatInput` is the single
shared local-format authority for **both** client and server — there must be no
second client-only or server-only format validator in v0. Reserved-word policy
and profanity layer **after** format validation so a self-owned immutable handle
keeps a grandfathered exact-match path.

## Checklist

### Dependencies

- [ ] `bun add obscenity transliteration`

### `handle-rules.ts`

- [ ] Export `HANDLE_FORMAT_VALIDATION_REASONS` and `HANDLE_VALIDATION_REASONS` const tuples (exact values per §5.3)
- [ ] Export `HandleFormatValidationReason`, `HandleValidationReason`, `HandleFormatValidationResult` types
- [ ] `validateHandleFormatInput(raw): HandleFormatValidationResult` — lowercase first, **never trim**, format rules only (no reserved policy)
- [ ] Enforce the exact failure precedence (§5.3): `empty` → `too_long` → `contains_at_sign` → `invalid_chars` → `leading_period` → `consecutive_periods` → `trailing_period`
- [ ] Return `{ status: "valid", normalizedHandle }` only when the whole rule set passes
- [ ] Reserved-word constant (base + protected app-language + official-ish sets, §5.5) + `isReservedHandle(normalizedHandle): boolean`, checked after lowercase normalization

### `handle-prefill.ts`

- [ ] `derivePassiveHandlePrefill(displayName)` (§5.4): transliterate→ASCII, lowercase, collapse non-alphanumeric runs → single `_`, trim leading/trailing `_`, truncate to 30, blank if empty
- [ ] Server-only transliteration dependency lives here (no email/`listener`/numeric-suffix fallback)

### `claim-handle-seed.ts`

- [ ] Export `ClaimHandleSeed = { kind: "owned"; handle } | { kind: "suggested"; handle } | { kind: "blank" }`
- [ ] `deriveClaimHandleSeed({ accountHandle, displayName })`: `owned` if handle non-null; else `suggested` from prefill if non-empty; else `blank`
- [ ] Delegates suggested-value generation to `derivePassiveHandlePrefill`

### `handle-profanity.ts`

- [ ] Server-only `obscenity` wrapper; before checking, strip `.` and `_` so `f.u_c.k` → `fuck`
- [ ] Use the library's default English dataset + recommended transformers; **no** app allowlist in v0
- [ ] Surface failures as reason `profanity`; **never** run in the browser

## Notes on intent

- `contains_at_sign` is intentionally separate from `invalid_chars` so the UI can
  explain `@fabio` specifically.
- `already_owned` is **not** a validation reason — it's an account-state recovery
  branch handled in the server contracts (Task 09). `taken` is the only ordinary
  "someone else has it" result.

## Files touched

`src/lib/domains/library/accounts/handle-rules.ts`,
`handle-prefill.ts`, `claim-handle-seed.ts`, `handle-profanity.ts` (all new),
`package.json`.

## Dependencies

None (pure domain logic). Consumed by Tasks 07, 09, 11.

## Related tests

Task 15 → §14.1 (shared rule tests), §14.2 (prefill), §14.3 (profanity).
