# Implementation Plan: handle identity

> Future-state plan. `account.handle`, the `claim-handle` onboarding step, handle validation/server contracts, and read-only handle display in settings do not exist yet.
>
> This plan supersedes parts of `claudedocs/handle-identity-exploration-2026-06-02.md` where planning decisions changed:
> - syntax follows Instagram-like username rules
> - v0 has no generated handle suggestion system
> - the claim field may passively prefill from normalized `account.display_name`
> - v0 has no handle-specific analytics

## 1. Framing note

Build the handle once as the app-owned public identity on `account`, then reuse it across public liked-songs sharing, the Jukebox, and later social/profile surfaces. V0 scope is:

- add `account.handle` plus the atomic claim RPC
- require handle claim during onboarding
- switch the current authenticated identity read surfaces to handle-first display (`Settings`, the authenticated shell sidebar, and the Dashboard header)
- mount a minimal public `/@handle` coming-soon route for handles whose owners have completed onboarding
- keep the handle immutable after claim in v0

This is identity infrastructure, not a standalone social feature.

## 2. Current repo state

- **`account` has no handle today.** `src/lib/data/database.types.ts`'s `account` row currently includes `better_auth_user_id`, `display_name`, `email`, `id`, `image_url`, `spotify_id`, `created_at`, and `updated_at`, but no `handle`.
- **The table is already private by default.** `supabase/migrations/20260116160005_add_rls_policies.sql` already adds `account_deny_all`, so a new `account.handle` column inherits the existing RLS posture without a policy change.
- **The onboarding machine has no claim step yet.** `src/lib/domains/library/accounts/onboarding-steps.ts` currently orders steps as:
  `welcome → pick-color → install-extension → syncing → flag-playlists → pick-demo-song → song-walkthrough → match-walkthrough → plan-selection → complete`.
- **The session/state layers match that current step list.** `src/features/onboarding/step-resolver.ts`, `src/lib/server/onboarding.functions.ts` (`deriveSession()`), and `src/features/onboarding/Onboarding.tsx` (`STEP_CONFIG`) all lack `claim-handle` today.
- **`SyncingStep` still auto-advances to `flag-playlists`.** `src/features/onboarding/components/SyncingStep.tsx` currently calls `goToStep("flag-playlists", { syncStats })` on completion, so inserting `claim-handle` into the step tuple alone would not make the new step reachable.
- **Onboarding guards already enforce step order from fresh server state, but that server state is currently step-driven.** `src/routes/_authenticated/route.tsx` fetches `getOnboardingSession()` with `staleTime: 0` and redirects based on `resolveSession()`. `src/routes/_authenticated/onboarding.tsx` separately blocks skip-ahead using `ONBOARDING_STEP_VALUES`. Today `deriveSession()` does not look at `account.handle`, so a later saved `onboarding_step` would bypass handle claim unless session derivation becomes handle-aware.
- **`saveOnboardingStep` already owns the post-sync cleanup list.** In `src/lib/server/onboarding.functions.ts`, transitioning past `syncing` clears `phase_job_ids`, but there is no `claim-handle` branch in that runtime list yet.
- **`OnboardingData` has no handle-specific payload yet.** `src/lib/server/onboarding.functions.ts` currently returns `playlists`, `phaseJobIds`, `syncStats`, `readyCopyVariant`, and `landingSongs`, but no claim-handle seed payload or public-origin preview data.
- **`syncStats` are currently duplicated between server-loaded onboarding data and router state.** `src/features/onboarding/components/FlagPlaylistsStep.tsx` reads `location.state?.syncStats ?? EMPTY_SYNC_STATS` and forwards that value through `goToStep(...)`, even though `src/lib/server/onboarding.functions.ts` already returns canonical DB-derived `OnboardingData.syncStats` and `PlanSelectionStep` already consumes that server-backed value.
- **`useOnboardingNavigation()` currently swallows transition failures while several callers behave as if it rejects.** `src/features/onboarding/hooks/useOnboardingNavigation.ts` catches save/fetch/navigate failures, toasts internally, and does not rethrow. But `WelcomeStep`, `PickColorStep`, `InstallExtensionStep`, and `FlagPlaylistsStep` each wrap `goToStep(...)` inside local `try/catch` flows. In particular, `WelcomeStep` only resets `isNavigating` inside `catch`, so a swallowed navigation failure can leave the CTA disabled until refresh.
- **Onboarding completion is currently a blind server write.** `src/lib/server/onboarding.functions.ts`'s `markOnboardingComplete()` currently just calls `completeOnboardingWithAllocations(...)`, and `src/lib/domains/library/accounts/onboarding-allocation.ts` does not re-check `account.handle` or the authoritative current onboarding session before stamping `onboarding_completed_at`. `src/features/onboarding/components/PlanSelectionStep.tsx` then assumes success and navigates to `/dashboard` once that call resolves.
- **The best passive prefill source is `account.display_name`.** In `src/routes/api/extension/sync.tsx`, extension sync updates `account.display_name` from the Spotify profile display name. There is no separate stored Spotify-username column to prefer instead.
- **Authenticated server functions already receive the account row.** `src/lib/platform/auth/auth.middleware.ts` injects both `context.session` and `context.account`, so handle-aware onboarding functions can read the caller's current handle without an extra auth lookup.
- **Settings currently show identity without a handle.** `src/routes/_authenticated/settings.tsx` passes `displayName`, `email`, and `imageUrl` into `src/features/settings/SettingsPage.tsx`, whose Account section renders avatar + display name + email only.
- **The authenticated shell and dashboard still show provider identity today.** `src/routes/_authenticated/route.tsx` currently passes `account?.display_name ?? account?.email ?? null` into `src/routes/_authenticated/-components/Sidebar.tsx` as `userName`, and `src/routes/_authenticated/dashboard.tsx` currently passes `account?.display_name ?? account?.email ?? null` into `src/features/dashboard/Dashboard.tsx` / `DashboardHeader` as `displayName`.
- **The local onboarding reset script does not clear `account.handle` today.** `scripts/reset-onboarding.ts` resets `user_preferences` fields but leaves the `account` row untouched, so once handle claim ships, `bun run reset:onboarding <email>` would no longer replay the first-claim path unless this change also clears the handle.
- **There is no shared text-input component to reuse.** `src/components/ui/` currently has primitives like `Button`, `UserAvatar`, `CDCase`, and `kbd`, but no shared `Input` component; existing forms style raw `<input>` elements locally.
- **There is no current public-site-origin env for canonical handle URLs.** `src/env.ts` includes `SERVER_URL`, but no dedicated public origin for constructing `https://hearted.music/@handle` consistently across environments.
- **There is no public `@handle` route today.** `src/routes/**` currently has no `createFileRoute('/@{$handle}')` (or equivalent), so a previewed `https://hearted.music/@handle` URL would currently land on the generic not-found page unless this change adds the route.
- **Handle-specific server contracts do not exist yet.** There is no dedicated `src/lib/server/account-handle.functions.ts` module today, `src/lib/server/onboarding.functions.ts` has no `checkHandleAvailability` or `claimHandleAndAdvance`, and there is no handle validation/domain module under `src/lib/domains/library/accounts/` today.
- **The needed moderation/transliteration dependencies are not installed yet.** `package.json` currently has neither `obscenity` nor a transliteration package.

## 3. Goals and locked product rules

### Goals

- Give every account one app-owned public handle stored on `account`.
- Make handle claim a required onboarding step before any consumer feature depends on it.
- Keep the v0 rules simple, familiar, and close to Instagram username behavior.
- Make the claim flow robust under refreshes, stale clients, and uniqueness races.
- Keep the handle immutable after claim in v0.

### Locked product rules

- **Ownership:** the public identity is `account.handle`, not a provider username.
- **Scope:** v0 covers onboarding claim, handle-first display on the current authenticated identity surfaces (`Settings`, the authenticated shell sidebar, and the Dashboard header), and a minimal public `/@handle` coming-soon route.
- **Change policy:** no self-serve renames in v0.
- **Claim timing:** required onboarding step, inserted immediately after `syncing`.
- **Syntax model:** Instagram-like username syntax, not the earlier slug model.
- **Generated suggestions:** none. There is no suffix-generation or alternate-suggestion system in v0.
- **Passive prefill:** allowed from normalized `account.display_name`, but only as a starting value the user can overwrite.
- **Analytics:** no handle-specific analytics in v0.
- **Rollout:** no feature flag; ship as the default onboarding flow after schema-first deploy.

## 4. Schema and migration plan

### 4.1 Add `account.handle`

Create a new migration:

```sql
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
```

Notes:

- `handle` stays nullable because pre-claim rows must continue to exist.
- The unique index is on canonical `handle` values directly. App-side lowercase folding plus server-side validation reject surrounding whitespace and other invalid raw input before write, while the DB format check keeps stored values canonical, so downstream reads can query plain `handle = normalizedHandle` without repeating `lower(btrim(...))` expressions.
- `account_handle_format_check` enforces the DB-side subset of the syntax contract: trimmed, lowercase, 1–30 chars, allowed charset only, no leading/trailing/consecutive periods.
- Reserved words and profanity remain app/server validation concerns; they do **not** belong in the DB constraint.
- No RLS migration is needed because `account` already has `account_deny_all`.

### 4.2 Create the atomic claim RPC

Create a second migration:

```sql
CREATE OR REPLACE FUNCTION public.claim_handle(
  p_account_id UUID,
  p_handle     TEXT
)
RETURNS TABLE (
  status TEXT,
  owned_handle TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_handle TEXT;
  v_existing_step TEXT;
  v_onboarding_completed_at TIMESTAMPTZ;
BEGIN
  SELECT handle
  INTO v_existing_handle
  FROM account
  WHERE id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'claim_handle: account % not found', p_account_id;
  END IF;

  SELECT onboarding_step, onboarding_completed_at
  INTO v_existing_step, v_onboarding_completed_at
  FROM user_preferences
  WHERE account_id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'claim_handle: preferences for account % not found', p_account_id;
  END IF;

  IF v_existing_handle IS NOT NULL AND v_existing_handle <> p_handle THEN
    RETURN QUERY SELECT 'already_owned'::TEXT, v_existing_handle;
    RETURN;
  END IF;

  IF v_existing_handle IS NULL
     AND v_onboarding_completed_at IS NULL
     AND (
       v_existing_step IN ('welcome', 'pick-color', 'install-extension', 'syncing')
       OR v_existing_step NOT IN (
         'claim-handle',
         'flag-playlists',
         'pick-demo-song',
         'song-walkthrough',
         'match-walkthrough',
         'plan-selection',
         'complete'
       )
     ) THEN
    RETURN QUERY SELECT 'not_ready'::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  IF v_existing_handle IS NULL THEN
    UPDATE account
    SET handle = p_handle
    WHERE id = p_account_id;

    v_existing_handle := p_handle;

    IF v_onboarding_completed_at IS NULL THEN
      UPDATE user_preferences
      SET
        onboarding_step = 'flag-playlists',
        phase_job_ids = NULL
      WHERE account_id = p_account_id;
    END IF;
  ELSIF v_onboarding_completed_at IS NULL AND v_existing_step = 'claim-handle' THEN
    UPDATE user_preferences
    SET
      onboarding_step = 'flag-playlists',
      phase_job_ids = NULL
    WHERE account_id = p_account_id;
  END IF;

  RETURN QUERY SELECT 'claimed'::TEXT, v_existing_handle;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_handle(UUID, TEXT)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_handle(UUID, TEXT)
TO service_role;
```

Why this shape:

- The RPC owns the two-table atomic write.
- `p_next_step` is intentionally **not** a parameter. In v0 there is only one legal forward transition owned by this RPC: `claim-handle → flag-playlists`.
- Expected business outcomes are returned as structured values, not exception-message strings:
  - `status = 'claimed'` means the submitted handle is authoritatively owned by this account after the RPC completes, covering both first claim and same-handle idempotent re-entry
  - `status = 'already_owned'` means this account already owns a different immutable handle; `owned_handle` carries that authoritative owned handle
  - `status = 'not_ready'` means the account still has no handle and the persisted onboarding state is still pre-claim
- First claim and same-handle re-entry are intentionally different:
  - **first claim from an earlier onboarding step** (`welcome`, `pick-color`, `install-extension`, `syncing`) returns `status = 'not_ready'`
  - **first claim from an invalid/unknown unfinished onboarding step token** also returns `status = 'not_ready'`, matching the app-side fallback-to-`welcome` semantics
  - **first claim from `claim-handle` or any later valid step token, including the inconsistent `complete`-without-timestamp case** canonicalizes the persisted onboarding step to `flag-playlists` whenever onboarding is not complete
  - whenever that unfinished-onboarding forward canonicalization happens, the RPC also clears `phase_job_ids` in the same `user_preferences` update so stale/buggy later-step rows do not retain sync job ids if the persisted `claim-handle` transition was skipped
  - **same-handle re-entry** must **not** rewind onboarding once the handle already exists; if the persisted step is still `claim-handle`, advance it to `flag-playlists`, otherwise leave later steps unchanged
- App-side ordering logic should be centralized in `src/lib/domains/library/accounts/onboarding-steps.ts`; the SQL RPC mirrors the same pre-claim rule because Postgres cannot import the TypeScript helpers. Integration tests must lock that mirror so app-side and DB-side ordering do not drift.
- Today `deriveAuthPayloadFromPrefs(...)` falls back to `"welcome"` when `ONBOARDING_STEPS.safeParse(prefs.onboarding_step)` fails. The SQL mirror must treat the same invalid/unknown unfinished tokens as pre-claim/not-ready rather than allowing claim.
- Missing `account` or `user_preferences` rows must still raise and abort the transaction. Structured status rows are reserved for expected business outcomes; missing rows and unexpected DB failures remain exceptions.
- Concurrent claims of the same handle across different accounts resolve at the unique index; one transaction wins, the loser gets `23505`.
- Concurrent submissions from two tabs on the same account are serialized by the `FOR UPDATE` locks on the `account` and `user_preferences` rows.
- The caller should treat `claim_handle` as an exact one-row contract and invoke it with `.single()` (plus response-shape validation) rather than depending on raw `data` arrays.

### 4.3 Types and env follow-up

After migrations:

- run `bun run gen:types`
- update env files for the new public-origin config described in §10

## 5. Handle syntax, normalization, and reserved-word rules

### 5.1 Canonical storage and server-side normalization

Stored handles are lowercase only.

Authoritative server-side normalization for submitted input is intentionally minimal:

1. lowercase
2. validate the result exactly as submitted otherwise

The server does **not** trim whitespace, it does **not** convert spaces or punctuation into separators for user-entered input, and it does **not** strip `@`. Invalid characters remain invalid. Any whitespace anywhere in the submitted value — including leading or trailing whitespace — must resolve to `invalid_chars` until the user removes it.

### 5.2 Syntax rules

V0 syntax follows Instagram-like rules:

- length: **1–30** characters
- charset: **`[a-z0-9._]`** only
- all-digit handles are allowed
- uppercase is folded to lowercase
- `@` is **not** allowed anywhere in the handle value; the public route prefix lives outside the stored handle (`/@fabio` comes from stored `fabio`)
- hyphens are **not** allowed
- spaces are **not** allowed
- periods are special:
  - cannot be the first character
  - cannot be the last character
  - cannot appear twice in a row (`..`)
- underscores are flexible:
  - may lead
  - may trail
  - may repeat (`__`)
  - may sit next to periods (`_.` / `._`)

Regex sketch:

```txt
^(?!\.)(?!.*\.\.)(?!.*\.$)[a-z0-9._]{1,30}$
```

This regex is only a sketch. The final word stays in explicit validation code so the UI can receive specific failure reasons.

### 5.3 Shared validation reason enum and authoritative rules API

Use one shared machine-readable vocabulary across local validation and ordinary unavailable availability / submit responses.

`src/lib/domains/library/accounts/handle-rules.ts` should export these exact constants and types:

```ts
export const HANDLE_FORMAT_VALIDATION_REASONS = [
  "empty",
  "too_long",
  "contains_at_sign",
  "invalid_chars",
  "leading_period",
  "trailing_period",
  "consecutive_periods",
] as const;

export const HANDLE_VALIDATION_REASONS = [
  ...HANDLE_FORMAT_VALIDATION_REASONS,
  "reserved",
  "profanity",
  "taken",
] as const;

export type HandleFormatValidationReason =
  (typeof HANDLE_FORMAT_VALIDATION_REASONS)[number];

export type HandleValidationReason =
  (typeof HANDLE_VALIDATION_REASONS)[number];

export type HandleFormatValidationResult =
  | { status: "valid"; normalizedHandle: string }
  | { status: "invalid"; reason: HandleFormatValidationReason };

export function validateHandleFormatInput(
  raw: string,
): HandleFormatValidationResult;

export function isReservedHandle(
  normalizedHandle: string,
): boolean;
```

`contains_at_sign` is intentionally separate from `invalid_chars`: the field is a bare handle input, while the product renders the public identity with an `@` prefix in URLs and read surfaces. That makes `@fabio` a likely mistake, so the UI should explain it specifically instead of collapsing it into a generic invalid-characters message.

`already_owned` is intentionally **not** part of this ordinary validation-reason vocabulary. It is an account-state stale-recovery branch that carries authoritative `ownedHandle` + `OnboardingAuthPayload`, not a user-correctable field error. `taken` remains the only ordinary user-correctable “someone else already has this handle” result.

`validateHandleFormatInput(raw)` is the single shared local-format authority for both client and server. Its contract is:

1. lowercase first
2. never trim
3. validate only the shared format rules; do **not** fold reserved-word policy into this function
4. return `{ status: "valid", normalizedHandle }` only when the entire shared local format rule set passes
5. when multiple format rules fail, return the **first** matching reason in this exact precedence order:
   1. `empty`
   2. `too_long`
   3. `contains_at_sign`
   4. `invalid_chars`
   5. `leading_period`
   6. `consecutive_periods`
   7. `trailing_period`

That precedence is part of the contract, not an implementation detail. Representative expected outcomes:

- `@help` → `contains_at_sign`
- `help.` → `trailing_period`
- `.help` → `leading_period`
- `foo..` → `consecutive_periods`
- `foo .` → `invalid_chars`
- `.help.` → `leading_period`

`isReservedHandle(normalizedHandle)` is the shared namespace-policy helper. Callers must only pass a canonical bare handle that already passed `validateHandleFormatInput(...)`.

Client and server both layer reserved-word blocking **after** successful format validation by calling `isReservedHandle(normalizedHandle)`. That split is intentional: reserved-word policy can change over time, while a self-owned immutable handle still needs a grandfathered exact-match path after format validation but before reserved/profanity policy checks.

Ordinary unavailable server responses may additionally produce `reserved`, `profanity`, and `taken`. Stale submitted values containing `@` should still resolve to `contains_at_sign` server-side, stale submitted values containing whitespace should still resolve to `invalid_chars` server-side, and stale submitted empty values should still resolve to `empty` server-side.

Call-site rule:

- the client uses `validateHandleFormatInput(currentValue)` for inline format status and CTA gating, then runs `isReservedHandle(normalizedHandle)` before allowing availability checks
- server functions use `validateHandleFormatInput(data.handle)` first; only after it succeeds may they compare against an owned handle or run `isReservedHandle(normalizedHandle)`, profanity, and taken checks
- no second client-only or server-only format validator should exist in v0; format validation and reserved-word policy both stay centralized in this module

### 5.4 Passive prefill algorithm

There is **no suggestion engine** in v0.

The step receives a discriminated loader seed instead of a bare string. This shared seed contract belongs in `src/lib/domains/library/accounts/claim-handle-seed.ts`, not in a server-functions module:

```ts
export type ClaimHandleSeed =
  | { kind: "owned"; handle: string }
  | { kind: "suggested"; handle: string }
  | { kind: "blank" };
```

Seed derivation:

- if `account.handle` is already non-null, return `{ kind: "owned", handle: account.handle }`
- else, derive a passive prefill from `account.display_name`
- if that derived value is non-empty, return `{ kind: "suggested", handle: derivedValue }`
- else, return `{ kind: "blank" }`

`owned` and `suggested` are intentionally different states:

- `owned` means the value is the user's already-owned immutable handle in v0
- `suggested` means the value is only a starting guess and still needs the normal availability flow

Display-name prefill derivation:

1. transliterate to ASCII
2. lowercase
3. replace every run of non-alphanumeric characters with a single underscore
4. trim leading/trailing underscores
5. truncate to 30 characters
6. if empty after normalization, return blank

Examples:

- `Fábio Galiano` → `fabio_galiano`
- `John / Jane` → `john_jane`
- `山田太郎` → transliterated ASCII if available from the transliteration library; otherwise blank

Important non-goals:

- no email fallback
- no `listener` fallback
- no alternate separator fallback
- no numeric suffix suggestion loop

If the passive prefill is taken, it stays visible and immediately resolves to an unavailable state on mount. The user edits it manually.

If the loader returns `kind: "owned"`, that value is not treated as a suggestion at all — it is the owned-handle state.

### 5.5 Reserved words

Keep a hand-rolled TS constant of exact reserved handles, checked after lowercase normalization.

Base set:

- `admin`
- `support`
- `help`
- `about`
- `official`
- `hearted`
- `team`
- `staff`
- `null`
- `undefined`

Protected app-language / public-surface set:

- `liked-songs`
- `jukebox`
- `settings`
- `login`
- `faq`
- `privacy`
- `terms`
- `forgot-password`
- `reset-password`
- `verify-email`

Additional official-ish set:

- `verified`
- `moderator`
- `founder`
- `press`
- `security`
- `legal`
- `billing`
- `contact`

These entries are intentionally reserved for product protection and brand safety, not because the current router would technically collide with `/@handle`. Even when a string could work as a namespaced handle in this routing model (for example `settings` → `/@settings`), v0 should still keep app-language, policy, auth, and official-sounding names out of the user namespace.

Because syntax disallows `-`, entries like `liked-songs`, `forgot-password`, and `reset-password` are unreachable by valid user input in v0, but keeping them in the reserved constant is still intentional so the protection policy is already in place if syntax broadens later.

Reserved-word blocking runs:

- locally for instant feedback
- on the server as the authority

### 5.6 Profanity blocking

Use `obscenity` on the server only.

Behavior:

- before profanity checking, strip `.` and `_` so separator obfuscation collapses
  - `f.u_c.k` → `fuck`
- use the library's default English dataset plus recommended transformers in v0
- do **not** add an app-defined profanity allowlist/whitelist in v0
- surface the failure as `profanity`

This is an intentional product choice for v0: rely on the library's built-in behavior rather than maintaining our own exception list. If real false positives show up later, revisit with concrete examples and add explicit product-owned exceptions then.

Do **not** run the profanity library in the browser in v0.

### 5.7 Recommended module split

Use small domain modules instead of one catch-all file:

- `src/lib/domains/library/accounts/handle-rules.ts`
  - `HANDLE_FORMAT_VALIDATION_REASONS`
  - `HANDLE_VALIDATION_REASONS`
  - `HandleFormatValidationReason`
  - `HandleValidationReason`
  - `HandleFormatValidationResult`
  - `validateHandleFormatInput(raw)` as the shared local-format authority for both client and server
  - reserved-word constant + `isReservedHandle(normalizedHandle)`
- `src/lib/domains/library/accounts/handle-prefill.ts`
  - passive prefill derivation from `display_name`
  - server-only transliteration dependency
- `src/lib/domains/library/accounts/claim-handle-seed.ts`
  - shared `ClaimHandleSeed` type
  - `deriveClaimHandleSeed({ accountHandle, displayName })`
  - composes owned/suggested/blank seed selection and delegates suggested-value generation to `derivePassiveHandlePrefill(displayName)`
- `src/lib/domains/library/accounts/handle-profanity.ts`
  - server-only `obscenity` wrapper

Dependencies:

- `bun add obscenity transliteration`

## 6. Server contracts and RPC design

### 6.0 Shared server module split

Create a dedicated server module for handle contracts:

- file: `src/lib/server/account-handle.functions.ts`
- exports:
  - `checkHandleAvailability`
  - `claimHandleAndAdvance`

Do **not** add these contracts to `src/lib/server/onboarding.functions.ts`. Handle claiming is reused identity infrastructure with onboarding-specific consequences, so it should not grow the already-large onboarding server module.

Before wiring those handle server functions, do one foundational type split so the new shared/server modules do **not** depend on `src/features/...`:

- new file: `src/lib/domains/enrichment/content-analysis/analysis-content.ts`
  - move the shared analysis payload read-path contract here and make it runtime-backed, not type-only:

```ts
export const analysisContentSchema = ...;
export type AnalysisContent = z.infer<typeof analysisContentSchema>;

export function parseAnalysisContent(
  value: unknown,
): AnalysisContent | null;
```

  - `parseAnalysisContent(...)` is the only boundary parser for `song_analysis.analysis` JSON in v0; callers should stop using unchecked `as AnalysisContent` casts on DB JSON
  - `analysis-content.ts` is a thin read-path seam over the existing content-analysis domain schemas, not a third independent schema authority invented by this handle plan
  - malformed analysis JSON should be logged at the boundary and treated as `null` analysis, not thrown; liked-song/detail/onboarding surfaces already tolerate missing analysis better than they tolerate page-breaking exceptions
  - when parsing returns `null`, callers should collapse the **outer** analysis wrapper to `null` (for example `WalkthroughSong.analysis = null`) rather than introducing partial objects with `content: null`
  - `src/features/liked-songs/types.ts` should import this type from the lib module instead of owning it

- new file: `src/lib/domains/library/accounts/onboarding-session.ts`
  - move the core onboarding session contracts here
  - exports:

```ts
export interface WalkthroughSongAnalysis {
  id: string;
  content: AnalysisContent;
  model: string;
  createdAt: string | null;
}

export type WalkthroughSong = {
  id: string;
  spotifyTrackId: string;
  slug: string;
  name: string;
  artist: string;
  artistId: string | null;
  artistImageUrl: string | null;
  album: string | null;
  albumArtUrl: string | null;
  genres: string[];
  analysis: WalkthroughSongAnalysis | null;
};

export type OnboardingSession =
  | { status: "welcome" }
  | { status: "pick-color" }
  | { status: "install-extension" }
  | { status: "syncing" }
  | { status: "claim-handle" }
  | { status: "flag-playlists" }
  | { status: "pick-demo-song" }
  | { status: "song-walkthrough"; song: WalkthroughSong }
  | { status: "match-walkthrough"; song: WalkthroughSong }
  | { status: "plan-selection" }
  | { status: "complete" };

export interface OnboardingAuthPayload {
  session: OnboardingSession;
  theme: ThemeColor | null;
}

export function sessionMode(
  session: OnboardingSession,
): "steps" | "walkthrough" | "complete"
```

  - this module owns the shared onboarding contracts (`WalkthroughSongAnalysis`, `WalkthroughSong`, `OnboardingSession`, `OnboardingAuthPayload`, `sessionMode(...)`)
  - it may import `ThemeColor` from `src/lib/theme/types` for `OnboardingAuthPayload`, but it must **not** own route-path strings or router helpers

- keep `src/features/onboarding/step-resolver.ts`, but reduce it to a thin route-mapping module that imports `OnboardingSession` from `src/lib/domains/library/accounts/onboarding-session.ts` and exports only:

```ts
export type AllowedPath =
  | "/onboarding"
  | "/liked-songs"
  | "/match"
  | "/dashboard";

export function resolveSession(
  session: OnboardingSession,
): { allowedPath: AllowedPath }

export function isPathAllowed(
  pathname: string,
  allowedPath: AllowedPath,
): boolean
```

  - after this split, `step-resolver.ts` must no longer define or export `OnboardingSession` / `WalkthroughSong`
  - `step-resolver.ts` should also stop exporting `sessionMode(...)`; that belongs with the session domain types in `src/lib/domains/library/accounts/onboarding-session.ts`
  - do **not** leave compatibility re-exports behind in `step-resolver.ts` for `OnboardingSession`, `WalkthroughSong`, or `sessionMode`. This change is a real ownership cut, not a soft alias layer.

Then extract the guard-critical onboarding session loading primitives into a small shared server module:

- file: `src/lib/server/onboarding-session.ts`
- exports:

```ts
export async function deriveAuthPayloadFromPrefs(args: {
  accountId: string;
  accountHandle: string | null;
  prefs: UserPreferences;
  supabase: AdminSupabaseClient;
}): Promise<OnboardingAuthPayload>

export async function loadOnboardingSession(args: {
  accountId: string;
  accountHandle: string | null;
}): Promise<OnboardingAuthPayload>
```

- this module owns loading/derivation functions only
- public exports are `deriveAuthPayloadFromPrefs(...)` and `loadOnboardingSession(...)`
- `deriveSession(...)` should live here too, but as an internal helper rather than a new cross-module export
- it should import `OnboardingAuthPayload`, `OnboardingSession`, and `WalkthroughSong` from `src/lib/domains/library/accounts/onboarding-session.ts`
- it must **not** redefine the shared `OnboardingAuthPayload` contract locally
- `deriveAuthPayloadFromPrefs(...)` is the single shared session-construction helper for both loaders: `loadOnboardingSession(...)` and `loadOnboardingData(...)` must both call it so `getOnboardingSession()` and `getOnboardingData()` cannot disagree about `session.status`

`src/lib/server/onboarding.functions.ts` and `src/lib/server/account-handle.functions.ts` should import `OnboardingSession` / `WalkthroughSong` / `OnboardingAuthPayload` from `src/lib/domains/library/accounts/onboarding-session.ts`, plus `deriveAuthPayloadFromPrefs(...)` / `loadOnboardingSession(...)` from `src/lib/server/onboarding-session.ts`. Do **not** make the new server modules import `src/features/onboarding/step-resolver.ts` or the entire onboarding server module just to reuse session loading.

### 6.1 Shared server input schema

Use one shared transport schema in `src/lib/server/account-handle.functions.ts` for both handle server functions:

```ts
const handleInputSchema = z.object({
  handle: z.string(),
});
```

Contract:

- both `checkHandleAvailability` and `claimHandleAndAdvance` must use `inputValidator(handleInputSchema)`
- keep this schema transport-only: it checks that `handle` exists and is a string
- do **not** put `.min()`, `.max()`, `.trim()`, regex rules, or reserved-word logic in this schema
- all business validation belongs in the shared handle domain rules so the server can return the planned typed result values like `{ status: "unavailable", reason: "empty" }` and `{ status: "unavailable", reason: "too_long" }` instead of surfacing framework-level input-validation failures
- this transport schema and the shared handle-rules module are intentionally different layers: shape validation here, semantic handle validation in the domain module

### 6.2 `checkHandleAvailability`

Add to `src/lib/server/account-handle.functions.ts`:

- method: `GET`
- middleware: `authMiddleware`
- input validator: `inputValidator(handleInputSchema)`
- transport input shape: `{ handle: string }`

Return type:

```ts
type CheckHandleAvailabilityResult =
  | { status: "available" }
  | {
      status: "already_owned";
      ownedHandle: string;
      onboarding: OnboardingAuthPayload;
    }
  | {
      status: "unavailable";
      reason: HandleValidationReason;
    }
  | { status: "error" };
```

Behavior:

1. lowercase the submitted value; do **not** trim whitespace
2. run `validateHandleFormatInput(data.handle)` first so malformed raw input (including empty input and leading/trailing whitespace) resolves to a specific reason like `empty` or `invalid_chars`, not `already_owned`
   - if validation fails, return `{ status: "unavailable", reason }`
   - if it succeeds, use the returned `normalizedHandle` for all later checks and queries in this request
3. if the caller already has a non-null `context.account.handle`:
   - if it equals `normalizedHandle`, return `{ status: "available" }` immediately and skip reserved-word, profanity, and taken checks
   - if it differs, return:

```ts
{
  status: "already_owned",
  ownedHandle: context.account.handle,
  onboarding: await loadOnboardingSession({
    accountId,
    accountHandle: context.account.handle,
  }),
}
```

4. run `isReservedHandle(normalizedHandle)`
   - if true, return `{ status: "unavailable", reason: "reserved" }`
5. run profanity check
6. run availability lookup against canonical `account.handle`, excluding the caller's own account id; once input is lowercased and format-validated, this is a plain equality check on `handle`
7. return:
   - `available`
   - `unavailable` with a specific reason
   - `already_owned` with authoritative recovery data for stale-tab correction
   - `error` for operational failures like DB/query failure or failure to build that authoritative recovery payload

Operational failures should be logged server-side and returned as `{ status: "error" }`, not thrown. The UI uses that branch to block Continue and show retry copy.

### 6.3 `claimHandleAndAdvance`

Add to `src/lib/server/account-handle.functions.ts`:

- method: `POST`
- middleware: `authMiddleware`
- input validator: `inputValidator(handleInputSchema)`
- transport input shape: `{ handle: string }`

Return type:

```ts
type ClaimHandleAndAdvanceResult =
  | {
      status: "claimed";
      ownedHandle: string;
      onboarding: OnboardingAuthPayload;
    }
  | { status: "not_ready"; onboarding: OnboardingAuthPayload }
  | {
      status: "already_owned";
      ownedHandle: string;
      onboarding: OnboardingAuthPayload;
    }
  | {
      status: "unavailable";
      reason: HandleValidationReason;
    };
```

Behavior:

1. lowercase the submitted value; do **not** trim whitespace
2. rerun `validateHandleFormatInput(data.handle)` first so malformed stale submissions (including empty input and surrounding whitespace) return their specific validation reason instead of collapsing to `already_owned`
   - if validation fails, return `{ status: "unavailable", reason }`
   - if it succeeds, use the returned `normalizedHandle` for all later checks and the RPC call in this request
3. if the caller already has a non-null `context.account.handle`:
   - if it differs from `normalizedHandle`, return:

```ts
{
  status: "already_owned",
  ownedHandle: context.account.handle,
  onboarding: await loadOnboardingSession({
    accountId,
    accountHandle: context.account.handle,
  }),
}
```

   - if it equals `normalizedHandle`, continue the same-handle idempotent path and skip reserved-word, profanity, and taken checks
4. if the caller does **not** yet have a handle, load the authoritative current onboarding session before claiming
   - app-side, determine “too early to claim” from the shared step-order helper (`isOnboardingStepBefore(step, "claim-handle")`), not from fresh inline step arrays
   - this pre-check is intentionally duplicated with the SQL RPC guard: the server function gives the client a typed recovery response without attempting the write, and the RPC remains the final backstop if a stale caller bypasses that app-side check
   - if that session is anything earlier than `claim-handle`, return:

```ts
{
  status: "not_ready",
  onboarding: currentOnboarding,
}
```

   This is an expected state mismatch, not an operational failure. The client should navigate from the returned session instead of guessing.
5. for the first-claim path, run `isReservedHandle(normalizedHandle)` and return `{ status: "unavailable", reason: "reserved" }` when it matches; otherwise run profanity check server-side
6. call the RPC as an exact one-row contract and validate the returned row shape in `src/lib/server/account-handle.functions.ts`:

```ts
const claimHandleRpcRowSchema = z.union([
  z.object({
    status: z.literal("claimed"),
    owned_handle: z.string(),
  }),
  z.object({
    status: z.literal("already_owned"),
    owned_handle: z.string(),
  }),
  z.object({
    status: z.literal("not_ready"),
    owned_handle: z.null(),
  }),
]);

const rpcResult = await supabase
  .rpc("claim_handle", {
    p_account_id: accountId,
    p_handle: normalizedHandle,
  })
  .single();
```

7. on `23505`, return `{ status: "unavailable", reason: "taken" }`
8. on any other RPC transport/DB failure, throw
9. parse `rpcResult.data` with `claimHandleRpcRowSchema`
10. if the parsed row is `{ status: "claimed", owned_handle }`, return the authoritative post-RPC session:

```ts
{
  status: "claimed",
  ownedHandle: owned_handle,
  onboarding: await loadOnboardingSession({
    accountId,
    accountHandle: owned_handle,
  }),
}
```

   Do **not** derive the success session from stale `context.account.handle`; middleware auth context was loaded before the RPC wrote the handle. Also do **not** rely on `normalizedHandle` alone when the RPC already returned the authoritative stored handle. The returned `ownedHandle` is the client-cache authority, and the returned `onboarding.session` is the navigation authority. On a **first** successful claim for an unfinished onboarding row (`onboarding_completed_at IS NULL`), that session must be `flag-playlists` (subject to the existing no-playlists route skip afterward), even if a premature later `onboarding_step` — including the inconsistent `complete`-without-timestamp case — had been saved before the claim. If the row was already completion-stamped but still missing a handle, the successful first claim must instead preserve that completed state and return `session.status = "complete"`; do **not** rewind a completion-stamped row to `flag-playlists`. A stale tab that resubmits the same already-claimed handle after the user has progressed to `pick-demo-song` or later must receive that later session back; the client must not assume `flag-playlists`.

11. if the parsed row is `{ status: "already_owned", owned_handle }`, recover the authoritative already-owned state instead of collapsing to a generic inline error:

```ts
{
  status: "already_owned",
  ownedHandle: owned_handle,
  onboarding: await loadOnboardingSession({
    accountId,
    accountHandle: owned_handle,
  }),
}
```

12. if the parsed row is `{ status: "not_ready", owned_handle: null }`, return:

```ts
{
  status: "not_ready",
  onboarding: await loadOnboardingSession({
    accountId,
    accountHandle: null,
  }),
}
```

13. if the RPC returns missing or shape-invalid data, let schema parsing throw; that is an operational failure, not an expected business branch

Expected failures are values. Only operational failures throw and surface as a toast.

This owned-exact-match bypass is intentional. In v0, an already-owned immutable handle is grandfathered for stale re-entry even if a later reserved-word or profanity policy change would block that same string for a new claim; otherwise the user could get stranded on an immutable handle with no rename path.

### 6.4 `markOnboardingComplete`

Keep `markOnboardingComplete` in `src/lib/server/onboarding.functions.ts`, but change it from a fire-and-forget `{ success: true }` mutation into an authoritative completion gate.

Contract:

- method: `POST`
- middleware: `authMiddleware`
- no input payload

Return type:

```ts
type MarkOnboardingCompleteResult =
  | { status: "completed_now"; onboarding: OnboardingAuthPayload }
  | { status: "already_complete"; onboarding: OnboardingAuthPayload }
  | { status: "not_ready"; onboarding: OnboardingAuthPayload };
```

Behavior:

1. load the authoritative current onboarding payload first:

```ts
const currentOnboarding = await loadOnboardingSession({
  accountId,
  accountHandle: context.account.handle,
});
```

2. if `currentOnboarding.session.status === "complete"`, return `{ status: "already_complete", onboarding: currentOnboarding }` immediately; do **not** rerun `completeOnboardingWithAllocations(...)` or duplicate free-allocation side effects
3. if `currentOnboarding.session.status !== "plan-selection"`, return `{ status: "not_ready", onboarding: currentOnboarding }`
   - this includes stale/buggy completion attempts from any earlier step
   - this includes handle-less rows that the shared session loader already collapses back to `claim-handle`
4. only when the authoritative current session is exactly `plan-selection` may the server call `completeOnboardingWithAllocations(...)`
5. after that write succeeds, rebuild the returned onboarding session from **freshly re-read account state**, not from middleware's pre-mutation `context.account.handle` snapshot, and return it
   - acceptable implementations include either fetching the current `account.handle` before calling `loadOnboardingSession(...)` or introducing a helper that reloads the authoritative account row internally before deriving the session
   - do **not** treat `context.account.handle` as authoritative after a mutating server function; it was loaded before the write

```ts
{ status: "completed_now", onboarding: completedOnboarding }
```

6. the post-write session **must** be `{ status: "complete" }`; if it is not, throw because that is an operational invariant failure
7. expected stale/out-of-order states are values, not toasts; operational failures still throw
8. client analytics must treat these statuses differently:
   - fire `analytics.capture("onboarding_completed", ...)` only on `status: "completed_now"`
   - do **not** fire completion analytics on `status: "already_complete"` or `status: "not_ready"`

Notes:

- keep `completeOnboardingWithAllocations(...)` as the lower-level side-effecting helper; no UI or devtools path should bypass the server contract and call it directly
- this closes the current hole where a stale client or devtools action could stamp `onboarding_completed_at` before a handle exists
- `PlanSelectionStep` and devtools must navigate from the returned `onboarding.session` via `resolveSession()` instead of assuming `/dashboard`

### 6.5 No dedicated rate limiting in v0

Do not add dedicated rate limiting to either handle server function in v0.

Why:

- both calls are authenticated
- the step is onboarding-only
- the client already debounces checks to 250ms
- local validity gating suppresses most wasteful requests

If handle editing later moves into Settings or a public surface, reopen this.

## 7. Onboarding machine changes

### 7.1 Insert the new step

Update `src/lib/domains/library/accounts/onboarding-steps.ts`:

```ts
welcome
pick-color
install-extension
syncing
claim-handle
flag-playlists
pick-demo-song
song-walkthrough
match-walkthrough
plan-selection
complete
```

`ONBOARDING_STEP_VALUES` remains the canonical ordered tuple for app-side onboarding sequencing, but it is **not** the only place order-sensitive behavior lives. Consolidate app-side step/order logic in this module instead of scattering `indexOf(...)` math or ad-hoc step arrays elsewhere.

Also export a second exact tuple for writable step targets:

```ts
export const SAVEABLE_ONBOARDING_STEP_VALUES = [
  "welcome",
  "pick-color",
  "install-extension",
  "syncing",
  "claim-handle",
  "flag-playlists",
  "pick-demo-song",
  "song-walkthrough",
  "match-walkthrough",
  "plan-selection",
] as const;

export type SaveableOnboardingStep =
  (typeof SAVEABLE_ONBOARDING_STEP_VALUES)[number];
```

`complete` intentionally stays out of `SAVEABLE_ONBOARDING_STEP_VALUES`. Helper/order code must still be able to reason about `complete`, but persistence-layer step mutations must make `saveOnboardingStep({ step: "complete" })` and `updateOnboardingStep(accountId, "complete")` unrepresentable.

`"song-walkthrough"` and `"match-walkthrough"` intentionally stay **inside** `SAVEABLE_ONBOARDING_STEP_VALUES`, but only for re-entry/navigation after a demo song already exists. They are prerequisite-bearing targets, not unconditional generic writes: `saveOnboardingStep` may only persist either walkthrough step when the current `user_preferences.demo_song_id` is already non-null.

Add shared helpers here and make other app code read them instead of reimplementing order rules:

```ts
export function compareOnboardingSteps(
  a: OnboardingStep,
  b: OnboardingStep,
): number

export function isOnboardingStepBefore(
  step: OnboardingStep,
  boundary: OnboardingStep,
): boolean

export function getPreviousOnboardingStep(
  step: OnboardingStep,
): OnboardingStep | null

export function getNextOnboardingStep(
  step: OnboardingStep,
): OnboardingStep | null

export function clearsSyncPhaseJobIds(
  step: OnboardingStep,
): boolean
```

Use these helpers for route/UI/devtools sequencing and phase-job cleanup. The only unavoidable mirror is the DB-side `claim_handle` SQL guard, which must stay aligned with `isOnboardingStepBefore(step, "claim-handle")` semantics for unfinished pre-claim steps.

`complete` stays in the ordered tuple so helper-driven code can reason about terminal prev/next relationships (`plan-selection ↔ complete`), but it is **not** a normal `saveOnboardingStep(...)` target. The only valid forward path into the complete session is `markOnboardingComplete()`. Enforce that at both layers:

- `updateOnboardingStep(accountId, step)` must narrow to `step: SaveableOnboardingStep`
- `saveOnboardingStep` must validate `step` with a transport schema that excludes `"complete"`
- `saveOnboardingStep` must also reject `"song-walkthrough"` and `"match-walkthrough"` unless the current `user_preferences.demo_song_id` is already non-null

That keeps `complete` unrepresentable at the mutation boundary, while still allowing walkthrough re-entry through the generic step mutation only when the walkthrough precondition already exists.

That server function must validate the authoritative current handle-aware session before writing completion: it may only complete from `plan-selection`, it must return `{ status: "not_ready", onboarding }` for stale/early attempts, `{ status: "completed_now", onboarding }` when this request actually completes onboarding, and `{ status: "already_complete", onboarding }` for idempotent re-entry after completion already existed. Any helper-driven devtools navigation that targets `complete` must therefore special-case that target and call `markOnboardingComplete()` instead of `saveOnboardingStep(...)`. Rewinding from `complete` to an earlier step in devtools may still use `saveOnboardingStep(...)`, and that rewind is intentionally completion-clearing.

For `clearsSyncPhaseJobIds(step)`, v0 should preserve the existing meaning of “clear once the user leaves `syncing`.” Concretely:

- return `false` for `welcome`, `pick-color`, `install-extension`, and `syncing`
- return `true` for `claim-handle` and every later onboarding step

That makes `saveOnboardingStep("claim-handle")` the moment finished sync job ids are cleared, matching the old `syncing → flag-playlists` behavior even though the new next step is `claim-handle`.

### 7.2 Session/state wiring

Update all existing onboarding machine touchpoints:

1. `src/lib/domains/library/accounts/onboarding-steps.ts`
   - insert `"claim-handle"`
   - export `SAVEABLE_ONBOARDING_STEP_VALUES`
   - export `type SaveableOnboardingStep = (typeof SAVEABLE_ONBOARDING_STEP_VALUES)[number]`
   - implement the shared helpers from §7.1
2. `src/lib/domains/library/accounts/preferences-queries.ts`
   - keep `ONBOARDING_STEPS = z.enum(ONBOARDING_STEP_VALUES)` for persisted-row parsing
   - add `SAVEABLE_ONBOARDING_STEPS = z.enum(SAVEABLE_ONBOARDING_STEP_VALUES)`
   - re-export `type SaveableOnboardingStep`
   - narrow `updateOnboardingStep(accountId, step)` to `step: SaveableOnboardingStep`
3. `src/lib/domains/enrichment/content-analysis/analysis-content.ts` (new)
   - move the shared `AnalysisContent` read-path contract here from `src/features/liked-songs/types.ts`
   - define `analysisContentSchema`, `type AnalysisContent = z.infer<typeof analysisContentSchema>`, and `parseAnalysisContent(value: unknown): AnalysisContent | null`
   - this module is a thin read-path seam over the existing content-analysis schema family already owned in `song-analysis.ts` / `concept-schema.ts`; do **not** invent a third unrelated schema authority here
   - `parseAnalysisContent(...)` must log malformed JSON and return `null`; do **not** throw for invalid stored analysis rows in this change
   - update `src/features/liked-songs/types.ts` and the new onboarding-session domain module to import this shared type from the lib path
   - any touched server/UI boundary in this change that currently does `as AnalysisContent` on raw DB JSON should switch to `parseAnalysisContent(...)` instead of preserving unchecked casts
   - if parsing returns `null`, keep existing wrapper contracts unchanged and collapse the outer analysis wrapper to `null`; do **not** widen `WalkthroughSongAnalysis.content` or other wrapper contracts to `AnalysisContent | null`
4. `src/lib/domains/library/accounts/onboarding-session.ts` (new)
   - move `WalkthroughSongAnalysis`, `WalkthroughSong`, `OnboardingSession`, `OnboardingAuthPayload`, and `sessionMode(...)` here
   - add `| { status: "claim-handle" }` to `OnboardingSession`
   - `OnboardingAuthPayload` shape is fixed here:

```ts
export interface OnboardingAuthPayload {
  session: OnboardingSession;
  theme: ThemeColor | null;
}
```

   - keep this module route-agnostic: no `AllowedPath`, no `resolveSession()`, no router imports
5. `src/features/onboarding/step-resolver.ts`
   - stop defining/exporting `OnboardingSession` and `WalkthroughSong`
   - stop exporting `sessionMode(...)`
   - import `OnboardingSession` from `src/lib/domains/library/accounts/onboarding-session.ts`
   - expand `AllowedPath` to include `"/dashboard"`
   - keep unfinished non-walkthrough steps, including `claim-handle`, resolving to `/onboarding`
   - change `resolveSession({ status: "complete" })` to return `{ allowedPath: "/dashboard" }`
   - keep this file focused on route/path resolution only; after the split, other modules should not import session-domain types or `sessionMode(...)` from here

   `resolveSession()` must become the single navigation authority for onboarding/session redirects. The codebase currently has a split rule (`complete` resolves to `/liked-songs` in `step-resolver.ts`, while `/onboarding` and `PlanSelectionStep` send completed users to `/dashboard`). This change removes that contradiction so claim-handle success, onboarding completion, route guards, and dev navigation all agree on the same destination for a completed session.
6. `src/routes/_authenticated/onboarding.tsx`
   - replace raw `ONBOARDING_STEP_VALUES.indexOf(...)` comparisons with `compareOnboardingSteps(...)`
   - keep the no-playlists skip as a separate explicit branch; only the generic step ordering should centralize behind the helper
7. `src/features/devtools/workflow-panel/DevWorkflowPanel.tsx`
   - replace inline prev/next `indexOf(...)` math with `getPreviousOnboardingStep(...)` / `getNextOnboardingStep(...)`
   - when helper-driven navigation targets `"complete"`, call `markOnboardingComplete()` instead of `saveOnboardingStep({ step: "complete" })`, then navigate from the returned `onboarding.session` via `resolveSession()`; if the server returns `status: "not_ready"`, follow that authoritative session instead of forcing completion
   - non-complete step targets continue using `saveOnboardingStep(...)`
   - import `OnboardingAuthPayload` from `src/lib/domains/library/accounts/onboarding-session.ts`, not from `src/lib/server/onboarding.functions.ts`
   - keep the panel reading the shared onboarding order from `onboarding-steps.ts`, not maintaining a separate navigation notion
8. `src/routes/_authenticated/route.tsx`
   - import `sessionMode` from `src/lib/domains/library/accounts/onboarding-session.ts`, not from `src/features/onboarding/step-resolver.ts`
9. `src/routes/_authenticated/match.tsx`
   - import `sessionMode` from `src/lib/domains/library/accounts/onboarding-session.ts`, not from `src/features/onboarding/step-resolver.ts`
10. `src/features/onboarding/components/PickDemoSongStep.tsx`
   - import `OnboardingAuthPayload` from `src/lib/domains/library/accounts/onboarding-session.ts`, not from `src/lib/server/onboarding.functions.ts`
   - keep `commitDemoSongAndEnterWalkthrough({ spotifyTrackId: string }): Promise<OnboardingAuthPayload>` as the only valid first-entry mutation from `pick-demo-song` into `song-walkthrough`; do **not** replace that transition with `saveOnboardingStep({ step: "song-walkthrough" })`
11. `src/features/liked-songs/LikedSongsPage.tsx`
   - import `OnboardingSession` and `WalkthroughSong` from `src/lib/domains/library/accounts/onboarding-session.ts`, not from `src/features/onboarding/step-resolver.ts`
12. `src/features/liked-songs/hooks/useLikedSongsCollection.ts`
   - import `WalkthroughSong` from `src/lib/domains/library/accounts/onboarding-session.ts`
13. `src/features/liked-songs/hooks/useLikedSongsPageData.ts`
   - import `WalkthroughSong` from `src/lib/domains/library/accounts/onboarding-session.ts`
14. `src/features/matching/WalkthroughMatchContent.tsx`
   - import `WalkthroughSong` from `src/lib/domains/library/accounts/onboarding-session.ts`
15. `src/__mocks__/onboarding.functions.stub.ts`
   - import `OnboardingAuthPayload`, `OnboardingSession`, and `WalkthroughSong` from `src/lib/domains/library/accounts/onboarding-session.ts`
   - stop locally redefining `OnboardingAuthPayload`; the stub must reuse the shared contract
16. `src/lib/server/onboarding-session.ts` (new)
   - move `deriveSession(...)`, `deriveAuthPayloadFromPrefs(...)`, and `loadOnboardingSession(...)` here
   - `deriveAuthPayloadFromPrefs(...)` and `loadOnboardingSession(...)` are the public exports; `deriveSession(...)` stays internal to this module
   - import `OnboardingAuthPayload`, `OnboardingSession`, and `WalkthroughSong` from `src/lib/domains/library/accounts/onboarding-session.ts`; do **not** redefine shared UI/session contracts in this server module
   - export `deriveAuthPayloadFromPrefs(args)` with the exact shared signature:

```ts
export async function deriveAuthPayloadFromPrefs(args: {
  accountId: string;
  accountHandle: string | null;
  prefs: UserPreferences;
  supabase: AdminSupabaseClient;
}): Promise<OnboardingAuthPayload>
```

   - `deriveAuthPayloadFromPrefs(...)` must be the single handle-aware session-construction helper used by both `loadOnboardingSession(...)` and `loadOnboardingData(...)`; do **not** leave a second step-only auth-payload path inside `src/lib/server/onboarding.functions.ts`
   - change `deriveSession(...)` to:

```ts
function deriveSession(
  accountId: string,
  accountHandle: string | null,
  onboardingStep: OnboardingStep,
  onboardingCompletedAt: string | null,
  walkthroughSong: WalkthroughSong | null,
): OnboardingSession
```

   - before the normal completion / step switch logic, enforce the handle prerequisite authoritatively:
     - if `accountHandle` is null
     - and either:
       - `onboardingCompletedAt` is non-null
       - or the persisted `onboardingStep` is `"claim-handle"` or any later step token, including the inconsistent `"complete"`-without-timestamp case
     - return `{ status: "claim-handle" }`

   This makes missing-handle state authoritative over both later saved step tokens **and** completion-stamped rows. A stale or manually-repaired row with `onboarding_completed_at IS NOT NULL` but `account.handle IS NULL` must still route to `claim-handle`; after the user successfully claims a handle, the same persisted completion timestamp then lets the authoritative session resolve back to `complete` without replaying onboarding.
17. `src/lib/server/onboarding.functions.ts`
   - import `OnboardingAuthPayload`, `OnboardingSession`, and `WalkthroughSong` from `src/lib/domains/library/accounts/onboarding-session.ts`, not from `src/features/onboarding/step-resolver.ts`
   - import `deriveAuthPayloadFromPrefs(...)` and `loadOnboardingSession(...)` from `src/lib/server/onboarding-session.ts`
   - import `SAVEABLE_ONBOARDING_STEPS` and `type SaveableOnboardingStep` from `src/lib/domains/library/accounts/preferences-queries.ts`
   - do **not** treat `src/lib/server/onboarding.functions.ts` as the ownership module for `OnboardingAuthPayload` after this split
   - replace the broad `stepInputSchema` with this exact transport schema:

```ts
const saveableStepInputSchema = z.object({
  step: SAVEABLE_ONBOARDING_STEPS,
});
```

   - `saveOnboardingStep` must therefore accept only `{ step: SaveableOnboardingStep }`; do **not** allow `"complete"` through this mutation boundary
   - before calling `updateOnboardingStep(...)`, `saveOnboardingStep` must load the current prefs whenever `data.step` is `"song-walkthrough"` or `"match-walkthrough"`
   - if that current prefs row has `demo_song_id = null`, `saveOnboardingStep` must throw and write nothing; generic step saving is not allowed to create a walkthrough row without its prerequisite song
   - `commitDemoSongAndEnterWalkthrough({ spotifyTrackId: string })` remains the only valid first-entry mutation into `song-walkthrough`
   - generic `saveOnboardingStep({ step: "match-walkthrough" })` remains valid in v0 because the existing flow can only reach it after `demo_song_id` was already established; no separate match-walkthrough RPC is needed in this plan
   - thread `context.account.handle` through `getOnboardingSession()`
   - keep `getOnboardingSession()` as the onboarding-facing wrapper over the shared session loader
   - replace `markOnboardingComplete()`'s current fire-and-forget `{ success: true }` contract with the structured completion contract from §6.4; it must load the authoritative handle-aware session before completing, return `{ status: "not_ready", onboarding }` for stale/early calls, return `{ status: "completed_now", onboarding }` when this request actually completes onboarding, and return `{ status: "already_complete", onboarding }` for idempotent re-entry
- after the completion write, its returned `onboarding` payload must be derived from freshly re-read account state, not from stale middleware `context.account.handle`
   - make `loadOnboardingData(...)` reuse `deriveAuthPayloadFromPrefs({ accountId, accountHandle: account.handle, prefs, supabase })` for `OnboardingData.session`; the account row is required for authoritative session derivation there, not only for `claimHandleSeed`
   - `getOnboardingData()` and `getOnboardingSession()` must therefore return the same `session.status` for the same persisted rows, including handle-less rows whose saved `onboarding_step` is later than `claim-handle`
   - replace the hardcoded sync-cleanup branch in `saveOnboardingStep` with `clearsSyncPhaseJobIds(data.step)`
     - `clearsSyncPhaseJobIds("claim-handle")` must be `true` so `phase_job_ids` are cleared immediately when the user leaves `syncing`
     - `claimHandleAndAdvance` / the `claim_handle` RPC should also clear `phase_job_ids` whenever they canonicalize unfinished onboarding forward to `flag-playlists`, as a defensive backstop for stale or buggy flows that skipped the persisted `claim-handle` transition
18. `src/lib/server/account-handle.functions.ts`
   - import `OnboardingAuthPayload`, `OnboardingSession`, and `WalkthroughSong` from `src/lib/domains/library/accounts/onboarding-session.ts`
   - import `loadOnboardingSession(...)` from `src/lib/server/onboarding-session.ts`
   - depend on the shared onboarding session domain/server modules only; do **not** import `src/features/onboarding/step-resolver.ts`
   - define `handleInputSchema`, `checkHandleAvailability`, and `claimHandleAndAdvance` here
19. `src/features/onboarding/Onboarding.tsx`
   - add `STEP_CONFIG["claim-handle"] = { render: (ctx) => <ClaimHandleStep ... /> }`
   - thread `accountId` through `Onboarding` → `StepContext` → `ClaimHandleStep` as an explicit prop/context value; `ClaimHandleStep` must not discover `accountId` indirectly from the auth query cache or by importing route context directly
   - wire the step with this exact prop contract:

```ts
interface ClaimHandleStepProps {
  accountId: string;
  claimHandleSeed: ClaimHandleSeed;
}
```

   - `STEP_CONFIG["claim-handle"]` should render exactly:

```tsx
<ClaimHandleStep
  accountId={ctx.accountId}
  claimHandleSeed={ctx.claimHandleSeed}
/>
```

   - `ClaimHandleStep` must not accept a flattened `initialHandle: string | null` prop in place of `ClaimHandleSeed`; the discriminated union is the whole point of the contract
   - do not mark it `hideIndicator` or `fullBleed`
   - this is intentional product behavior, not an incidental implementation default: the onboarding progress indicator should gain one additional visible step in this change
   - indicator philosophy for v0: visible indicator steps represent durable user decisions or milestones, not only invisible system transitions
   - `claim-handle` is included in that visible indicator set because choosing a public immutable handle is a durable user-owned identity decision, even though the step is visually lighter than playlist selection or demo-song picking
   - sync completion should therefore advance the user into a new visible progress state (`claim-handle`), not silently skip it inside the indicator model
20. `src/features/onboarding/components/SyncingStep.tsx`
   - change sync-complete navigation to `goToStep("claim-handle")`, not `"flag-playlists"`
   - do **not** pass `syncStats` through router state on this transition
   - await the returned transition result from `goToStep(...)`
   - if it returns `{ status: "transition_failed" }`, keep the completed syncing view visible, show toast copy `Sync finished, but we couldn't continue. Refresh to keep going.`, and do **not** schedule repeated auto-retries until refresh/remount
21. `src/features/onboarding/components/WelcomeStep.tsx`, `src/features/onboarding/components/PickColorStep.tsx`, `src/features/onboarding/components/InstallExtensionStep.tsx`, `src/features/onboarding/components/FlagPlaylistsStep.tsx`, `src/features/onboarding/hooks/useOnboardingNavigation.ts`, `src/features/onboarding/hooks/useStepNavigation.ts`, and `src/features/onboarding/types.ts`
   - remove router-state `syncStats` threading entirely
   - stop reading `location.state?.syncStats`
   - stop passing `syncStats` through `goToStep(...)`
   - remove `syncStats` from the TanStack Router `HistoryState` augmentation and from `useOnboardingNavigation()`'s options
   - keep `syncStats` as a server-loaded `OnboardingData` field only; no second client-side transport is needed in v0
   - narrow `goToStep(step, ...)` to `step: SaveableOnboardingStep`
   - narrow `navigateTo(nextStep)` in `src/features/onboarding/hooks/useStepNavigation.ts` to `nextStep: SaveableOnboardingStep`; keep its existing pending/toast behavior otherwise unchanged
   - define and export this exact hook result contract from `src/features/onboarding/hooks/useOnboardingNavigation.ts`:

```ts
export type OnboardingStepTransitionResult =
  | { status: "transitioned" }
  | { status: "transition_failed" };
```

   - `goToStep(...)` must return `Promise<OnboardingStepTransitionResult>`
   - on a successful save → authoritative session refetch → navigation sequence, return `{ status: "transitioned" }`
   - on any save/fetch/navigate operational failure, log and return `{ status: "transition_failed" }`; do **not** throw and do **not** toast inside the hook
   - this structured result contract applies to `useOnboardingNavigation()` only; `useStepNavigation()` keeps its current resultless async behavior, but it must also exclude `"complete"` at the type level by accepting `SaveableOnboardingStep`
   - callers must branch on the returned status instead of relying on `try/catch` around `goToStep(...)` for ordinary transition failures
   - `WelcomeStep` failure behavior:
     - if `goToStep("pick-color")` returns `{ status: "transition_failed" }`, set `isNavigating` back to `false`
     - keep the user on the Welcome step
     - show toast copy `Couldn't continue. Please try again.`
   - `PickColorStep` failure behavior:
     - keep the existing save-theme failure branch for `saveThemePreference(...)`
     - if theme save succeeds but `goToStep("install-extension")` returns `{ status: "transition_failed" }`, keep the selected theme in place, set `isSaving` back to `false`, keep the user on Pick Color, and show toast copy `Your theme was saved, but we couldn't continue. Please try again.`
   - `InstallExtensionStep` failure behavior:
     - keep the existing extension/pairing/reset failure branch for work that happens before navigation
     - if pairing, `resetSyncJobs()`, and `triggerExtensionSync()` have already succeeded but `goToStep("syncing", { phaseJobIds: null })` returns `{ status: "transition_failed" }`, set `isAdvancing` back to `false`, keep the user on Install Extension, and show toast copy `Sync started, but we couldn't continue. Refresh to keep going.`
   - `FlagPlaylistsStep` failure behavior:
     - keep the existing playlist-save failure branches for `savePlaylistTargets(...)`
     - if playlist save succeeds but `goToStep("pick-demo-song")` returns `{ status: "transition_failed" }`, set `isSaving` back to `false`, keep the current selection state, keep the user on Flag Playlists, and show toast copy `Your playlist preferences were saved, but we couldn't continue. Please try again.`
22. `src/features/onboarding/components/PlanSelectionStep.tsx`
   - change the `Start Exploring` submit path to use the structured `markOnboardingComplete()` contract from §6.4, not a fire-and-forget mutation
   - on `{ status: "completed_now", onboarding }`, patch `queryKey = ["auth", "onboarding-session"]` with the returned payload, fire `analytics.capture("onboarding_completed", ...)`, and navigate from `resolveSession(onboarding.session)`; do **not** hardcode `/dashboard`
   - on `{ status: "already_complete", onboarding }`, patch `queryKey = ["auth", "onboarding-session"]` with the returned payload and navigate from `resolveSession(onboarding.session)`, but do **not** fire completion analytics again
   - on `{ status: "not_ready", onboarding }`, patch `queryKey = ["auth", "onboarding-session"]` with the returned payload, navigate from `resolveSession(onboarding.session)`, and do **not** toast; this is authoritative stale/out-of-order recovery
   - only operational failures toast

Import ownership rule after this refactor:

- `src/lib/domains/library/accounts/onboarding-session.ts` is the only source for `OnboardingAuthPayload`, `OnboardingSession`, `WalkthroughSong`, and `sessionMode(...)`
- `src/features/onboarding/step-resolver.ts` is only for route/path resolution (`AllowedPath`, `resolveSession`, `isPathAllowed`)
- non-routing consumers must not keep importing session-domain types or `sessionMode(...)` from `src/features/onboarding/step-resolver.ts`
- `src/lib/server/onboarding-session.ts` owns session loading/derivation, not the `OnboardingAuthPayload` contract

### 7.3 Loader/context additions

Extend onboarding payload/context with:

- `claimHandleSeed: ClaimHandleSeed`
- `accountId: string`

Lock the exact shared/client-facing shapes for this seam so the claim step does not have to infer ownership state from a flattened string:

```ts
export interface OnboardingData extends OnboardingAuthPayload {
  accountId: string;
  claimHandleSeed: ClaimHandleSeed;
  playlists: OnboardingPlaylist[];
  phaseJobIds: PhaseJobIds | null;
  syncStats: SyncStats;
  readyCopyVariant: ReadyCopyVariant;
  landingSongs: LandingSongManifest[];
}

interface StepContext {
  accountId: string;
  claimHandleSeed: ClaimHandleSeed;
  localTheme: ThemeColor;
  setLocalTheme: (theme: ThemeColor) => void;
  phaseJobIds: PhaseJobIds | null;
  playlists: OnboardingData["playlists"];
  landingSongs: LandingSongManifest[];
  syncStats: OnboardingData["syncStats"];
  readyCopyVariant: ReadyCopyVariant;
}
```

`syncStats` should remain in this server-loaded onboarding payload/context as the single source of truth. Do **not** preserve or reintroduce a duplicate router-state `syncStats` path once `claim-handle` is inserted.

Define the shared seed contract in `src/lib/domains/library/accounts/claim-handle-seed.ts`:

```ts
export type ClaimHandleSeed =
  | { kind: "owned"; handle: string }
  | { kind: "suggested"; handle: string }
  | { kind: "blank" };

export function deriveClaimHandleSeed(args: {
  accountHandle: string | null;
  displayName: string | null;
}): ClaimHandleSeed;
```

`src/lib/server/onboarding.functions.ts` should import that shared type/helper when building `OnboardingData`; it must not become the ownership module for `ClaimHandleSeed`.

That means updating:

- `OnboardingData`
- `StepContext`
- `src/routes/_authenticated/onboarding.tsx`
- `loadOnboardingData()`
- `Onboarding.tsx`

Change the wiring so the authenticated account row is available where both the full onboarding session and the seed are derived. Concretely:

- change `getOnboardingData` to call something like:

```ts
loadOnboardingData({
  accountId: context.session.accountId,
  account: context.account,
})
```

- update `loadOnboardingData`'s signature accordingly
- after loading `prefs`, build the auth payload by reusing the same shared helper as `loadOnboardingSession(...)`:

```ts
const authPayload = await deriveAuthPayloadFromPrefs({
  accountId,
  accountHandle: account.handle,
  prefs: prefsResult.value,
  supabase,
});
```

- `loadOnboardingData(...)` must **not** keep a second step-only `authPayloadPromise` path that ignores `account.handle`; `OnboardingData.session` must stay identical to the session returned by `getOnboardingSession()` for the same account state
- derive `claimHandleSeed` from the same explicit account row via the shared helper:

```ts
const claimHandleSeed = deriveClaimHandleSeed({
  accountHandle: account.handle,
  displayName: account.display_name,
});
```

Do not hide this behind an implicit `context` dependency inside `loadOnboardingData()`; make the account input explicit, avoid a second account lookup, and reuse the already-fetched prefs instead of issuing a second prefs read. Thread the same explicit `accountId` from `src/routes/_authenticated/onboarding.tsx` into `Onboarding` / `StepContext` so `ClaimHandleStep` can build its required React Query key (`['onboarding', 'handle-availability', accountId, ownedHandleSnapshot, debouncedHandle]`) without guessing through the auth cache or route imports. The whole point of the seed type is to prevent the client from having to guess whether a prefilled value is already owned or merely suggested, and the whole point of the shared helper is to prevent `getOnboardingData()` from disagreeing with `getOnboardingSession()` about the authoritative session.

### 7.4 Guard behavior

No special **route-specific** branch is needed beyond the existing generic redirects, but authoritative session derivation **must** become handle-aware.

Why:

- `/_authenticated/route.tsx` already redirects unfinished sessions to `/onboarding?step=<status>`
- `/onboarding` already blocks skip-ahead based on `ONBOARDING_STEP_VALUES`
- once `deriveSession()` returns `{ status: "claim-handle" }` whenever `account.handle` is still null, the existing guards automatically pin the user to the right step
- this is not in tension with the completion-stamped recovery path: before claim, missing handle outranks a non-null `onboarding_completed_at`; after successful claim, that preserved completion timestamp lets the same row resolve back to `complete`

So the enforcement layer is:

1. `SyncingStep` navigates to `claim-handle`
2. `deriveSession()` treats missing `account.handle` as authoritative and collapses any later saved onboarding step back to `claim-handle`
3. the existing route guards simply follow that authoritative session

The existing `flag-playlists → pick-demo-song` no-playlists skip stays unchanged after a successful claim.

Progress-indicator note: inserting `claim-handle` is intended to increase the visible onboarding-step count by one. That is the product decision for v0, not an accidental consequence of leaving `hideIndicator` false. The indicator now reflects that public-handle choice as a first-class milestone in the user's onboarding progress.

## 8. `ClaimHandleStep` UX, state machine, and copy

### 8.1 Layout and placement

Create `src/features/onboarding/components/ClaimHandleStep.tsx`.

Use the standard centered onboarding step treatment, not full-bleed. This step should visually sit closer to `PickColorStep` than to `FlagPlaylistsStep` or `PickDemoSongStep`.

Implement the step as a semantic `<form>`, not as a keyboard-shortcut-driven pseudo-form. This step is the exception to the other onboarding steps' `useShortcut("enter")` pattern because the current global keyboard provider ignores shortcut handling while focus is inside `<input>` / `<textarea>` elements. Native form submission is the authoritative Enter behavior here.

### 8.2 Copy

Heading:

- `Claim your @handle`

Primary CTA:

- default label: `Continue`
- keep the label `Continue` in every non-submit state, including blank, format-invalid, reserved, debounce-gap, checking, availability error, and edited-away owned state
- while saving: `Saving...`
- do not introduce a separate `Checking...` button label or button spinner in v0; the dynamic status region is the only place that should say `Checking availability…`
- disabled non-submit states should use the existing standard disabled button styling

Always-visible helper copy under the field:

- render this in a dedicated static helper block below the input (for example `claim-handle-helper`)
- `Enter just the name — we’ll add the @ in your public URL. Use letters, numbers, periods, or underscores. Periods can’t start, end, or appear twice in a row.`

### 8.3 Input behavior

- visible `<label>`: `Handle`
- single bare text input — no visual `@` prefix inside the field
- do **not** set an HTML `maxLength` on the input; overlength values must remain visible so the UI can show the explicit `too_long` validation state instead of silently truncating user input
- placeholder: `fabio`
- `autoFocus` on mount
- set `autoCapitalize="none"`, `autoCorrect="off"`, `spellCheck={false}`, and `autoComplete="off"`
- this is a username-like identifier field, not prose or profile-name entry; browser capitalization, autocorrect, spellcheck, and autofill heuristics should not interfere with handle input in v0
- seed the field from `claimHandleSeed`:
  - `owned` → prefill with the owned handle
  - `suggested` → prefill with the suggested handle
  - `blank` → start empty
- leave normal browser caret behavior for prefilled values

Manual typing behavior is validation-forward, not slugification:

- lowercase as the user types
- preserve other typed characters exactly as entered
- do **not** strip spaces, `@`, hyphens, overlength characters, or other invalid symbols for the user
- local validation then decides whether the current value is claimable
- `@` is invalid anywhere in the field:
  - `@fabio` → `contains_at_sign`
  - `f@bio` → `contains_at_sign`
  - `fabio@` → `contains_at_sign`
- allow temporary period-invalid intermediate states while editing
  - `.fabio`
  - `fabio.`
  - `fabio..galiano`

If `claimHandleSeed.kind === "owned"`, the field starts in an owned-handle state:

- while the current field value still exactly equals `claimHandleSeed.handle`, treat it as the owned value
- if the user edits away from that owned value, keep the field editable but disable Continue immediately
- in that edited-away owned state, render a small inline text button labeled `Use @${claimHandleSeed.handle}` that restores the owned handle into the field

During submit, the input must become `readOnly` (not `disabled`) so the submitted value stays frozen and focus does not jump away from the field. The current visible value should remain in place while the request is in flight.

### 8.4 Local validation vs server availability

The component should maintain three distinct concepts:

1. **local format validity**
2. **latest server availability result**
3. **owned-handle state** (`claimHandleSeed.kind === "owned"` and current field value exactly equals `claimHandleSeed.handle`)

Rules:

- Continue is actionable-only in v0. It must stay disabled unless the current value is claimable **right now**.
- if the field is empty, keep the static helper visible, leave the dynamic status region empty, and keep Continue disabled
- local empty state is intentionally neutral before submit/requests; it does **not** render the explicit `empty` error copy on its own
- if the component is in owned-handle state:
  - show the owned inline status
  - skip availability checks entirely
  - Continue enables whenever submit is not in flight as a stale-state safeguard for the exceptional case where this account already owns a handle but is still on `claim-handle`
- if `claimHandleSeed.kind === "owned"` but the current field value differs from `claimHandleSeed.handle`:
  - short-circuit normal validation/availability messaging
  - show the owned-handle reminder instead
  - keep Continue disabled
  - do not run availability checks for alternative values in v0
  - Enter / submit in this state should do nothing; do not auto-reset the field, do not run availability, and do not call `claimHandleAndAdvance`
- otherwise (`suggested` or `blank` paths):
  - if the field is format-invalid, show the specific inline format error and keep Continue disabled
  - format-invalid includes `contains_at_sign` whenever the visible field contains `@` anywhere
  - format-invalid includes `invalid_chars` when the visible field contains spaces, hyphens, or any other symbol outside `[a-z0-9._]`
  - format-invalid includes `too_long` whenever the visible field length exceeds 30 characters
  - if the field passes format validation but `isReservedHandle(normalizedHandle)` is true, show the inline `reserved` state, keep Continue disabled, and do not run availability
  - only when the field is non-empty, format-valid, and not locally reserved should availability checks run
  - while availability is checking, Continue stays disabled and the button label remains `Continue`
  - during the neutral debounce gap after editing a format-valid, non-reserved value, Continue stays disabled
  - if the latest availability result is `error`, keep Continue disabled and render the inline retry action described in §8.6; recovery is through `Check again`, not through submit
  - if the latest availability result is `already_owned`, treat it as authoritative stale-state correction: patch caches from the returned `ownedHandle` + `onboarding` payload and navigate immediately instead of leaving the user on the form or waiting for submit
  - submit-time `status: "unavailable"` for the current visible value becomes the new authoritative current-value verdict on the client
    - replace any prior `available` verdict for that same visible value
    - drive the same dynamic status region from that returned `reason`
    - keep Continue disabled until the user edits or an explicit retry path re-establishes availability
    - hide the public preview while that unavailable verdict is active
    - do **not** auto-fire a follow-up availability request for the same unchanged value after a submit-time unavailable result
  - Continue enables only when:
    - local format is valid
    - the current normalized value is not locally reserved
    - latest authoritative current-value verdict is `available`
    - submit is not in flight

When the user edits the field after a previous availability result or submit-time unavailable verdict, clear the previous current-value verdict immediately and wait for the next debounced check. During that neutral debounce gap, keep the static helper visible, leave the dynamic status region empty, and keep Continue disabled.

Native form submission must follow the same actionable-only rule as the button state:

- the form's `onSubmit` handler should always `preventDefault()` and route through one explicit submit-state branch owned by the component
- pressing Enter or clicking Continue while the current value is **owned-handle actionable** should proceed directly to the claim submit path in §8.8
- pressing Enter while the current value is **format-valid, not locally reserved, but has no current availability verdict yet** (including the debounce gap right after editing) should do nothing; the debounced availability check remains the only way to establish availability in that state
- while an availability request is already in flight for the current visible value, additional Enter presses / submit attempts should also do nothing; do not start duplicate availability requests and do not bypass the in-flight debounced check
- if the latest availability result is `error`, submit attempts should keep the user on the step and preserve the existing retry state; do not skip straight to `claimHandleAndAdvance`
- for non-owned values, `claimHandleAndAdvance` is reserved for states whose latest authoritative availability result for the current visible value is already `available`
- blank, format-invalid, locally reserved, edited-away owned, debounce-gap, checking, and availability-error states are all non-actionable; the button remains disabled and ordinary mouse interaction must not rely on submit-time branching for those states

### 8.5 Availability-check cadence

- debounce: **250ms**
- if `claimHandleSeed.kind === "suggested"` and the value is format-valid plus not locally reserved, check availability immediately on mount
  - if that immediate mount-time check returns `status: "error"`, keep the suggested value visible in the focused input, show the operational error state immediately in the dynamic status region, hide the public preview, keep Continue disabled, and allow recovery either by editing the field or activating `Check again`
  - editing after that mount-time error must clear the error verdict immediately and return the UI to the neutral debounce-gap state before the next automatic check
- if `claimHandleSeed.kind === "blank"`, wait for the user to type before checking
- if `claimHandleSeed.kind === "owned"`, do **not** run availability on mount and do **not** run availability for edited alternative values; the user already owns a handle and v0 does not allow renames
- use React Query for the debounced availability lookup
- query key: `['onboarding', 'handle-availability', accountId, ownedHandleSnapshot, debouncedHandle]`
  - `accountId` is the authenticated account id
  - `ownedHandleSnapshot` is `claimHandleSeed.handle` for `kind: "owned"`, otherwise `null`
  - this key is intentionally account-scoped because `checkHandleAvailability` can return caller-specific results (`available` for self-owned exact match, `already_owned` with authoritative onboarding recovery, or `taken` for another account) for the same visible handle string
  - including the owned-handle snapshot also ensures the query identity changes cleanly if the client patches `queryKey = ["auth", "session"]` after a successful claim or authoritative stale-tab recovery in the same browser session
- configure that query with `retry: false`, `refetchOnWindowFocus: false`, `refetchOnReconnect: false`, and `gcTime: 0`
- availability UI state must only reflect the current debounced handle; older in-flight results for previously edited values must not overwrite the current field's status or CTA gating
- implementation may satisfy that by React Query key isolation, request cancellation, comparing the current debounced handle before applying results, or a combination of those techniques; the behavioral requirement is what matters in the plan
- returning to a previously checked value after editing away from it must trigger a fresh live check, not immediate cached verdict reuse
- do not fire availability checks for format-invalid or locally reserved values
- an explicit retry trigger should bypass debounce and refetch immediately for the current visible value
- submit attempts from a format-valid, not locally reserved, but currently unchecked value should **not** bypass debounce; availability remains automatic-only in that state
- while a submit request is in flight, do **not** start new availability checks and do **not** let late availability responses overwrite the field's submit-time UI state; the submit path owns the field until that request settles

### 8.6 Inline feedback model

Render two text rows below the input:

1. a dedicated static helper block that is always visible
2. a separate dynamic status region for owned/validation/availability feedback

The dynamic status region under the field is the single source of truth for expected feedback states.

Owned states:

- owned-handle state → `Using your current handle.`
- owned seed edited away from the owned value → `Your handle is already @${claimHandleSeed.handle}.`
  - render inline reset action: `Use @${claimHandleSeed.handle}`
  - activating the reset action restores the owned handle, clears the reminder state, and returns focus to the input with the caret at the end

Specific inline copy for claimable values should map from the failure reason:

- `empty` → `Enter a handle to continue.`
- ordinary local empty editing still shows the neutral helper state from §8.4
- server-returned/stale-submission `empty` should reuse this same `empty` copy; there is no separate second message for local vs server-returned empty
- because Continue is disabled while blank, this `empty` copy is not a normal button-click outcome in the initial blank state; it exists for defensive submit handling and stale server returns
- `contains_at_sign` → `Don’t include @ — it’s added to your public URL.`
- `invalid_chars` → `Use only letters, numbers, periods, or underscores.`
- `leading_period` → `Periods can’t start a username.`
- `trailing_period` → `Periods can’t end a username.`
- `consecutive_periods` → `Periods can’t appear twice in a row.`
- `too_long` → `Handles can be up to 30 characters.`
- `reserved` → `That handle is reserved.`
- `profanity` → `That handle isn’t allowed.`
- `taken` → `That handle is taken.`

Availability states for claimable values:

- checking → `Checking availability…`
  - this message lives only in the dynamic status region; the primary CTA should still read `Continue`
- available → `Available.`
- operational failure → `Couldn’t check that handle — try again.`
  - render inline text button: `Check again`
  - activating `Check again` reruns `checkHandleAvailability` immediately for the current visible value without requiring the user to edit the field
  - this same recovery path applies when the first immediate mount-time check for a suggested seed fails operationally
  - while that retry request is in flight, status returns to `Checking availability…`
  - once that retry settles and the step remains mounted, focus returns to the input with the caret at the end, regardless of whether the retry resolved to `available`, `unavailable`, or `error`

Expected submit failures (`taken`, `reserved`, `profanity`, etc.) should reuse the same inline status region. Do **not** toast them. For the unchanged submitted value, that submit-time `unavailable` result replaces any prior `available` verdict and remains the authoritative current-value verdict until the user edits.

Availability-time `status: "already_owned"` and submit-time `status: "already_owned"` are both authoritative stale-state correction branches, not inline validation errors. The client should patch caches and navigate from the returned authoritative state instead of leaving the user stranded on the claim form.

Operational submit failures should still toast and keep the user on the step.

### 8.7 Live public preview

Show the muted full-host preview only when the current field value is actually actionable:

- `owned` seed and current value still equals the owned handle → show preview
- `suggested` / `blank` path → show preview only when the latest authoritative current-value verdict is `available`
- hide preview for empty, format-invalid, locally reserved, `checking`, `taken`, `profanity`, availability `error`, and edited-away owned state

Preview shape:

- label: `Public URL`
- value: `${publicAppOrigin}/@${handle}`
- render it as non-interactive display text only — no anchor, no button, no click handler, no keyboard activation, and no copy affordance in v0
- the previewed URL does **not** become publicly reachable until the owner finishes onboarding

`publicAppOrigin` here should come from shared public config (`VITE_PUBLIC_APP_ORIGIN`), not from onboarding loader data.

### 8.8 Submit path

On Continue / Enter:

- the primary CTA is a real submit button (`type="submit"`)
- Enter submission comes from native form behavior while focus is in the handle input
- do **not** add a global `useShortcut({ key: "enter" })` handler for this step
- the form submit handler should always `preventDefault()` and then branch from the current UI state instead of relying on the browser's default submit navigation
- before any network work, snapshot the current visible value and decide which submit branch applies:
  - **owned-handle actionable** → proceed to the claim submit branch below
  - **latest authoritative current-value verdict is `available` for the current visible value** → proceed to the claim submit branch below
  - **owned seed edited away from the owned value** → do nothing; keep the typed value and owned-handle reminder visible, do not auto-reset the field, do not run availability, and do not call `claimHandleAndAdvance`
  - **format-valid, not locally reserved, but unchecked / debounce-gap** → do nothing; wait for the automatic debounced availability check to settle, do not call `claimHandleAndAdvance`
  - **currently checking** → no-op for duplicate submit attempts while that current-value availability request is in flight
  - **availability error** → keep the existing retry state; do not call `claimHandleAndAdvance` until availability has successfully returned `available`
  - **blank, format-invalid, or locally reserved** → treat as a defensive no-op path only; keep the current value in place, do not start availability, and do not call `claimHandleAndAdvance`. In ordinary mouse usage these states are unreachable because Continue is disabled.
- only the actual claim submit branch should flip the input to `readOnly`; no-op submit states leave the input editable and unchanged
- on actual claim submit start:
  - capture the current visible value as the request-owned submitted handle
  - set the input to `readOnly`
  - keep the submitted value visible in the field while the request is in flight
  - suspend availability rechecks / ignore late availability responses until the request settles

1. call `claimHandleAndAdvance({ handle })`
2. if the result is `{ status: "not_ready", onboarding }`:
   - `queryClient.setQueryData(["auth", "onboarding-session"], result.onboarding)`
   - do **not** patch `queryKey = ["auth", "session"]` because no handle was claimed
   - derive the destination from `result.onboarding.session` via `resolveSession()`
   - if `allowedPath === "/onboarding"`, navigate to `/onboarding?step=${result.onboarding.session.status}`
   - otherwise navigate to the resolved non-onboarding path
   - do **not** toast; this is an expected stale/out-of-order state correction
3. if the result is `{ status: "already_owned", ownedHandle, onboarding }`:
   - `queryClient.setQueryData(["auth", "onboarding-session"], result.onboarding)`
   - also patch `queryKey = ["auth", "session"]` so the authenticated account cache reflects the authoritative owned handle immediately:

```ts
queryClient.setQueryData(["auth", "session"], (prev) =>
  prev
    ? {
        ...prev,
        account: {
          ...prev.account,
          handle: ownedHandle,
        },
      }
    : prev,
)
```

   - derive the destination from `result.onboarding.session` via `resolveSession()`
   - if `allowedPath === "/onboarding"`, navigate to `/onboarding?step=${result.onboarding.session.status}`
   - otherwise navigate to the resolved non-onboarding path
   - do **not** toast; this is an expected stale-tab recovery path, not a user-correctable validation error
4. if the result is `{ status: "claimed", ownedHandle, onboarding }`:
   - `queryClient.setQueryData(["auth", "onboarding-session"], result.onboarding)`
   - also patch the authenticated account cache at `queryKey = ["auth", "session"]`
   - cache updater must preserve `session` and `identity`, and only replace `account.handle` with the authoritative `ownedHandle` returned by the server

```ts
queryClient.setQueryData(["auth", "session"], (prev) =>
  prev
    ? {
        ...prev,
        account: {
          ...prev.account,
          handle: ownedHandle,
        },
      }
    : prev,
)
```

   - derive the destination from `result.onboarding.session` via `resolveSession()`
   - if `allowedPath === "/onboarding"`, navigate to `/onboarding?step=${result.onboarding.session.status}`
   - otherwise navigate to the resolved non-onboarding path
   - if the returned session is `complete`, this path is `/dashboard`
5. any submit outcome that keeps the user on the step must restore editability before returning control to the user:
   - set the input back to editable (`readOnly = false`)
   - keep the submitted value in the field
   - return focus to the input and place the caret at the end
6. do **not** call `saveOnboardingStep()` or `goToStep()` afterward

The RPC already performed the authoritative write, and the returned session is authoritative. Do **not** hardcode `flag-playlists` on the client; stale-tab same-handle re-entry may legitimately return `pick-demo-song`, a walkthrough step, or `complete`. If a buggy/stale client submits before the account has actually reached `claim-handle`, the server returns `status: "not_ready"` with the authoritative session and the client simply navigates there. When the returned session is `complete`, the client should land on `/dashboard` via `resolveSession()`, matching the rest of the onboarding flow.

Patching `queryKey = ["auth", "session"]` is required whenever `ClaimHandleStep` learns an authoritative owned handle from the server — successful claim plus availability-time or submit-time `already_owned` recovery — because `/_authenticated/route.tsx` caches the authenticated account row for 5 minutes and `src/routes/_authenticated/settings.tsx` reads account data from that route context. Without this cache update, same-session navigation to Settings can still show a stale `account.handle` until a reload or cache expiry.

If the user has no playlists, the normal first-claim path still returns `flag-playlists`, and the route guard will immediately skip it to `pick-demo-song` as it does today.

### 8.9 Accessibility

Required:

- semantic `<form>` element with a submit button so Enter works natively from the focused input
- visible `<label>`
- helper and status text connected via `aria-describedby`
- the static helper block should have its own stable id (for example `claim-handle-helper`)
- the dynamic status region should have its own stable id (for example `claim-handle-status`)
- only the dynamic status region uses `aria-live="polite"`; the always-visible helper block must not be a live region
- visible focus ring
- if the inline reset action is rendered, it must be reachable by Tab and activatable by Enter/Space
- if the inline retry action is rendered, it must also be reachable by Tab and activatable by Enter/Space
- when the retry action is focused, Enter activates retry rather than submitting the form
- after reset-action activation, focus returns to the input
- after retry-action activation, once the retry settles and the step remains mounted, focus returns to the input with the caret at the end
- during submit, prefer `readOnly` over `disabled` on the input so focus remains stable on the field
- if a submit outcome keeps the user on the step, focus returns to the input with the caret at the end
- disabled button state reflects the real gating logic

## 9. Settings and other read surfaces

### 9.1 Settings

Update:

- `src/routes/_authenticated/settings.tsx`
- `src/features/settings/SettingsPage.tsx`

Make `handle` the primary displayed identity in the Account section.

Settings contract:

- `src/routes/_authenticated/settings.tsx` should pass `handle`, `email`, and `imageUrl` into `src/features/settings/SettingsPage.tsx`
- `SettingsPage` should treat `@handle` as the primary identity line
- `UserAvatar` should be called as `name={handle}` / `imageUrl={imageUrl}` so initials also derive from the handle when no avatar image exists
- do **not** render `account.display_name` as the displayed name in this v0 Settings surface; `display_name` remains a passive prefill source, not the public-facing identity
- render `email` as the secondary line below `@handle`
- if `handle` is unexpectedly null, keep the section non-throwing and omit the `@handle` line rather than rendering a placeholder

Do not add:

- edit control
- copy button
- rename UI
- confirm dialog

### 9.2 Authenticated app shell + dashboard

Update:

- `src/routes/_authenticated/route.tsx`
- `src/routes/_authenticated/-components/Sidebar.tsx`
- `src/routes/_authenticated/-components/Sidebar.stories.tsx`
- `src/routes/_authenticated/dashboard.tsx`
- `src/features/dashboard/Dashboard.tsx`
- `src/features/dashboard/sections/DashboardHeader.tsx`
- `src/features/dashboard/types.ts`
- `src/stories/fixtures/build-fixtures.ts`

Authenticated-surface contract:

- these authenticated identity surfaces must also treat the handle as the displayed identity in v0; do **not** leave Sidebar and Dashboard on `account.display_name`
- rename props away from provider-name semantics:

```ts
interface SidebarProps {
  unsortedCount: number;
  handle: string | null;
  userPlan: string;
  userBalance?: number | null;
  userImageUrl?: string | null;
  showUpgradeCTA?: boolean;
}

export interface DashboardProps {
  accountId: string;
  handle: string | null;
  recentActivity: ActivityItem[];
  matchPreviews: MatchPreview[];
  stats: DashboardStats;
  lastSyncText: string;
}

interface DashboardHeaderProps {
  accountId: string;
  stats: DashboardStats;
  handle: string | null;
  lastSyncText: string;
}
```

- `src/routes/_authenticated/route.tsx` should pass `account?.handle ?? null` into `Sidebar`, not `account.display_name` or `account.email`
- `src/routes/_authenticated/dashboard.tsx` should pass `account?.handle ?? null` into `Dashboard`, not `account.display_name` or `account.email`
- `Sidebar` should call `UserAvatar` as `name={handle}` / `imageUrl={userImageUrl}` so initials derive from the raw handle when no avatar image exists
- `Sidebar` should render `@${handle}` as its identity line when `handle` exists
- `DashboardHeader` should render `@${handle}` as the heading when `handle` exists
- if `handle` is unexpectedly null on any of these authenticated surfaces, keep the surface non-throwing and omit the identity line / heading; do **not** fall back to `account.display_name` or `account.email` in v0
- `Sidebar.stories.tsx` and `src/stories/fixtures/build-fixtures.ts` must follow the renamed `handle` prop contract so stories/fixtures stop encoding the old provider-name semantics

### 9.3 Public `@handle` route in this change

Add a minimal public route so the `@handle` namespace exists in v0, but make it live only after the owner finishes onboarding.

Create:

- `src/routes/@{$handle}.tsx`
  - `createFileRoute('/@{$handle}')`
  - this route shape is intentional and valid TanStack Router syntax for a static `@` prefix plus an in-segment dynamic param; no virtual-route workaround or catch-all parser is needed here
- `src/features/public-handle/PublicHandleComingSoonPage.tsx`
- `src/lib/server/public-handle.functions.ts`
  - add the public server contract the route loader calls:

```ts
export const getPublicHandleIdentity = createServerFn({ method: "GET" })
  .inputValidator(z.object({ handle: z.string() }))
  .handler(async ({ data }): Promise<PublicHandleIdentity | null> => { ... })
```

- `src/lib/domains/library/accounts/queries.ts`
  - keep the admin-client query helper here:

```ts
export interface PublicHandleIdentity {
  handle: string;
  imageUrl: string | null;
}

export function getPublicHandleIdentityByHandle(
  handle: string,
): Promise<Result<PublicHandleIdentity | null, DbError>>
```

Domain query contract (`getPublicHandleIdentityByHandle`):

- use the admin client because `account` remains deny-all under RLS
- normalize the incoming handle with lowercase-only rules before lookup
- query from `account` and inner-join `user_preferences` so the completed-onboarding requirement is enforced in the same cardinality contract as the handle lookup
- require both:
  - matching `account.handle`
  - matching `user_preferences.onboarding_completed_at IS NOT NULL`
- select only `handle` and `image_url`
- expect **0 or 1** live row because `account.handle` is unique and each account should have at most one `user_preferences` row; implement the query as an exact `maybeSingle()`-style contract rather than reading an array and picking the first row
- if the DB reports multiplicity or another query error, return `Result.err(...)`; do **not** collapse unexpected multiplicity into `null`
- map the selected row immediately into the app-facing `PublicHandleIdentity` shape (`image_url` → `imageUrl`) inside this query helper; the DB-to-app field mapping belongs here, not in the route loader or page component
- `imageUrl` here is the current Spotify-sourced profile image URL stored on `account.image_url`; v0 does not add a separate app-owned avatar field
- return `null` only when no matching live public handle exists, including accounts whose `account.handle` is set but whose onboarding is not yet complete, or rows missing the required joined `user_preferences` completion stamp

Public server-function contract (`getPublicHandleIdentity` in `src/lib/server/public-handle.functions.ts`):

- method: `GET`
- no auth middleware
- input validator: `z.object({ handle: z.string() })`
- lowercase the submitted handle before lookup
- server-function canonicalization is lowercase-only; do **not** trim, strip `@`, collapse separators, or otherwise repair malformed handle strings here
- call `getPublicHandleIdentityByHandle(...)`
- if the domain query returns `Result.err(...)`, throw so the route error boundary handles it
- if the domain query returns `Result.ok(null)`, return `null`
- if the domain query returns `Result.ok(identity)`, return that `PublicHandleIdentity`
- this server function is the only boundary the route loader should call; the route file must **not** import the admin-client domain query directly

Route behavior:

- public / no auth required
- loader lowercases `params.handle` and treats that lowercase value as the canonical public identifier
- if `params.handle !== params.handle.toLowerCase()`, redirect to the canonical lowercase route `/@${params.handle.toLowerCase()}` before running the lookup
- route-layer canonicalization is lowercase-only; do **not** add trim/format validation here. Non-canonical-but-lowercase values should simply miss the lookup and fall through to `notFound()`.
- loader resolves the canonical lowercase handle via `getPublicHandleIdentity({ data: { handle: canonicalHandle } })`
- if the server function returns `null`, `throw notFound()` and let the existing root not-found UI render
- if the server function throws or the loader otherwise hits an operational failure, throw and let the normal route/root error UI handle it
- if the handle exists and the owner has completed onboarding, render a minimal coming-soon page; do **not** redirect to Settings
- set the public route title to `@${identity.handle} — Public profile coming soon • hearted.`
- do **not** add a v0 `noindex` robots override for this route; the `/@handle` URL is intentionally public and indexable once the owner has completed onboarding
- if the owner has a handle but has not yet completed onboarding, treat the route as not live yet and fall through to `notFound()` via the null result

Coming-soon page contract:

- `src/features/public-handle/PublicHandleComingSoonPage.tsx` should accept exactly:

```ts
interface PublicHandleComingSoonPageProps {
  identity: PublicHandleIdentity;
}
```

- use the existing `UserAvatar` as `name={identity.handle}` and `imageUrl={identity.imageUrl}`
- primary identity line: `@${identity.handle}`
- do **not** render `account.display_name` or a second provider-name line on this page in v0; the handle is the displayed identity
- heading: `Public profile coming soon.`
- route/page metadata title: `@${identity.handle} — Public profile coming soon • hearted.`
- route/page robots policy: no special v0 `noindex`; once the handle is live, treat the page as an indexable public URL
- body copy: `More public Hearted features are on the way.`
- CTA link: `Back to hearted.` → `/`

Hard exclusions in this v0 route:

- no liked-song data
- no playlist/jukebox data
- no edit controls
- no private account fields beyond `handle` and the Spotify-sourced `image_url`

Future consumers (`/@handle` public sharing, `/@handle/jukebox`) should build on the same `account.handle` identity but are out of scope for this route's v0 content.

### 9.4 Auth/account plumbing

No special auth-session redesign is needed, but the authenticated account cache does need one explicit client-side patch whenever `ClaimHandleStep` learns an authoritative owned handle: after successful claim and after either availability-time or submit-time `already_owned` recovery.

Why:

- account queries already `select("*")`
- `requireAuthSession()` and `authMiddleware` already expose the account row
- after `bun run gen:types`, `account.handle` naturally flows into authenticated route context
- however, `/_authenticated/route.tsx` caches `queryKey = ["auth", "session"]` for 5 minutes, and Settings reads `account` from that cached route context

Required behavior:

- after successful claim, `ClaimHandleStep` must patch both:
  - `queryKey = ["auth", "onboarding-session"]`
  - `queryKey = ["auth", "session"]`
- after authoritative availability-time `status: "already_owned"` recovery, `ClaimHandleStep` must also patch those same two query keys using the returned `ownedHandle` and `onboarding`
- after authoritative submit-time `status: "already_owned"` recovery, `ClaimHandleStep` must patch those same two query keys using the returned `ownedHandle` and `onboarding`
- the `queryKey = ["auth", "session"]` patch updates only `account.handle`; it must not replace or drop `session`, `identity`, or other `account` fields
- no separate settings-only fetch is needed in v0 once that cache patch is in place

## 10. Public URL/origin configuration

Introduce a dedicated env-backed public origin for externally surfaced public links:

- env name: `VITE_PUBLIC_APP_ORIGIN`
- production value: `https://hearted.music`
- local value: `http://127.0.0.1:5173`

This canonical origin supersedes older `hearted.app` examples in related exploration docs.

### 10.1 Env changes

Update:

- `src/env.ts`
- `src/env.public.ts`
- `.env`
- `.env.local`
- `.env.example`
- `.env.cloud`
- any env docs / README snippets that enumerate required vars

`VITE_PUBLIC_APP_ORIGIN` should be required and validated as a URL in the client/public env path.

Source-of-truth contract:

- `src/env.public.ts` should expose `VITE_PUBLIC_APP_ORIGIN` as a **required validated** public env value, not an optional best-effort string
- `src/lib/config/public-app-origin.ts` should read this variable from `src/env.public.ts`, not from `src/env.ts`
- `src/env.ts` may still include the variable in broader env validation/wiring if needed by repo conventions, but the cross-runtime public-link helper should depend on the public env module so client imports do not reach through the server env layer

### 10.2 Canonicalization

Before use, trim a trailing slash so URL construction cannot produce `//`.

Expose one shared helper for public-link construction in a cross-runtime module:

- file: `src/lib/config/public-app-origin.ts`

```ts
getPublicAppOrigin(): string
buildPublicHandleUrl(handle: string): string
```

Contract for that module:

- it must be importable from both client code (`ClaimHandleStep`) and server code (`src/lib/email/waitlist-confirmation.ts`)
- it should import `VITE_PUBLIC_APP_ORIGIN` from `src/env.public.ts`, not `src/env.ts`
- `getPublicAppOrigin()` should return the validated public origin with exactly one canonicalization step applied: trim a trailing slash if present
- `buildPublicHandleUrl(handle: string)` should compose from that canonical origin plus `/@${handle}` and assume the caller passes a canonical bare handle
- it owns origin trimming and `/@` concatenation so onboarding and future sharing surfaces do not duplicate URL assembly rules
- do **not** duplicate separate client-only and server-only URL builders for the same public-link contract in v0

### 10.3 Current and future consumers

Current consumers in this change / repo:

- `ClaimHandleStep` live preview — import `buildPublicHandleUrl(...)` from `src/lib/config/public-app-origin.ts`
- `src/lib/email/waitlist-confirmation.ts` footer link — replace the hardcoded `https://hearted.music` by importing the same shared helper module

Future consumers:

- public liked-songs sharing
- public profile / copy-link surfaces
- `/@handle` sibling features such as Jukebox

### 10.4 Explicit non-consumers

Do **not** use `VITE_PUBLIC_APP_ORIGIN` for:

- runtime same-origin extension handshake flows that correctly use `window.location.origin`
- already-generated auth callback / verification / password-reset URLs passed into email functions
- non-URL brand strings like support email addresses

This env is the canonical source for externally surfaced public links, not a universal replacement for every origin-like string in the codebase.

## 11. Key flows

### 11.1 First load, no current handle

1. user reaches `claim-handle`
2. loader computes `claimHandleSeed` as either `{ kind: "suggested", handle }` from `display_name` or `{ kind: "blank" }`
3. input renders focused
4. if the seed is `suggested` and locally valid, availability check runs immediately
5. Continue stays disabled until the latest valid check says available

### 11.2 Prefill is taken

1. prefill renders in the input
2. mount-time availability check returns `taken`
3. inline status says `That handle is taken.`
4. Continue remains disabled
5. user edits the field manually until availability becomes `available`

### 11.3 Successful first claim

1. user clicks Continue
2. server revalidates and calls `claim_handle(...)`
3. RPC writes `account.handle`
4. because this is the **first** claim, RPC canonicalizes `user_preferences.onboarding_step = 'flag-playlists'` when onboarding is not complete, even if a premature later step token had been saved earlier
5. server returns fresh `OnboardingAuthPayload`
6. client updates the `onboarding-session` query cache
7. client navigates from the returned authoritative session
8. in the normal unfinished first-claim path, that means `flag-playlists`, and the route guard may auto-skip to `pick-demo-song` if there are no playlists

### 11.4 Idempotent stale re-entry

1. the account already has a handle
2. loader returns `claimHandleSeed = { kind: "owned", handle: existingHandle }`
3. input shows that existing handle and inline status says `Using your current handle.`
4. no availability request is needed while the field still equals the owned handle
5. Continue is immediately allowed
6. if the user edits away from the owned value, Continue disables and the status row says `Your handle is already @${existingHandle}.` with reset action `Use @${existingHandle}`
7. submit with the unchanged owned handle reuses the same handle
8. if persisted `user_preferences.onboarding_step` is still `claim-handle`, the RPC advances it to `flag-playlists`
9. if persisted step is already later than `claim-handle` (for example `pick-demo-song`), the RPC leaves it unchanged
10. the server returns the fresh authoritative session, and the client navigates to that returned state instead of forcing `flag-playlists`

### 11.5 Self-healing completion-stamped row missing a handle

1. a stale/manual row exists with `onboarding_completed_at IS NOT NULL` but `account.handle IS NULL`
2. authoritative session derivation still returns `claim-handle`
3. user claims a handle successfully
4. `claim_handle(...)` writes only `account.handle`; it does **not** rewind the row to `flag-playlists` because onboarding is already completion-stamped
5. server reloads the authoritative session with the new handle and returns `session.status = "complete"`
6. client patches caches and navigates to `/dashboard` via `resolveSession()`

### 11.6 Plan-selection completion

1. user clicks `Start Exploring`
2. client calls `markOnboardingComplete()`
3. server loads the authoritative handle-aware onboarding session
4. if that session is still exactly `plan-selection`, server completes onboarding, returns `{ status: "completed_now", onboarding }`, and the returned session is `complete`
5. if the authoritative session is earlier instead (including `claim-handle` for handle-less rows or any other stale/out-of-order step), server returns `{ status: "not_ready", onboarding }` without completing
6. client patches `queryKey = ["auth", "onboarding-session"]`
7. client navigates from `resolveSession(result.onboarding.session)` instead of assuming `/dashboard`

## 12. Edge cases and failure handling

| Case | Behavior |
|---|---|
| `display_name` is null or normalizes to empty | loader returns `claimHandleSeed = { kind: "blank" }` |
| account already has a handle on loader entry | loader returns `claimHandleSeed = { kind: "owned", handle }`; no mount availability check runs |
| user edits away from an owned seed value | show `Your handle is already @handle.` plus reset action `Use @handle`; keep Continue disabled and skip availability checks |
| user types uppercase | field lowercases it live; server lowercases stale uppercase submissions too |
| user types or pastes `@fabio`, `f@bio`, or `fabio@` | field preserves the `@` visibly, local validation shows `contains_at_sign`, and availability does not run until the user removes it; server still rejects stale invalid input as `contains_at_sign` |
| stale submit sends an empty handle | server returns `{ status: "unavailable", reason: "empty" }`; the client stays on the step and uses the shared inline status region to show `Enter a handle to continue.` |
| user types spaces, pastes surrounding whitespace, or enters other invalid symbols | field preserves them visibly, local validation shows `invalid_chars`, and availability does not run until the user removes them; server still rejects stale invalid input as `invalid_chars` |
| user types a hyphen | field preserves it visibly and local validation shows `invalid_chars` |
| user types or pastes more than 30 characters | field preserves the full visible value, local validation shows `too_long`, Continue stays disabled, and availability does not run until the user shortens it; the browser must not silently truncate via `maxLength` |
| user types `.fabio`, `fabio.`, or `fabio..x` while editing | allow temporarily in the field, but show inline local error and do not run availability check |
| locally reserved handle | show inline `reserved`; do not call the availability query |
| profanity | only the server decides; availability or submit returns `profanity` inline |
| submit happens before the account has actually reached `claim-handle` | server returns `status: "not_ready"` with the authoritative current `OnboardingAuthPayload`; client navigates from that returned session and does not patch `account.handle` |
| first claim happens after a buggy/stale client had already saved a later onboarding step | RPC still canonicalizes the first post-claim step to `flag-playlists` |
| current account already has the same handle | self-check returns `available` immediately without reserved/profanity/taken checks; submit is allowed and idempotent; if the user already advanced later, the RPC must not rewind `onboarding_step` |
| current account already has a different handle | availability returns `status: "already_owned"` with `ownedHandle` + authoritative `OnboardingAuthPayload`, patches caches, and navigates immediately; submit uses the same authoritative recovery shape if a stale client somehow reaches it |
| row is completion-stamped (`onboarding_completed_at IS NOT NULL`) but `account.handle` is still null | authoritative session derivation still returns `claim-handle`; successful claim preserves the completion timestamp and returns `session.status = "complete"` instead of rewinding to `flag-playlists` |
| stale/buggy completion submit happens before the account has actually reached `plan-selection` (including handle-less later-step rows collapsed to `claim-handle`) | `markOnboardingComplete` returns `status: "not_ready"` with the authoritative current `OnboardingAuthPayload`; the client patches `queryKey = ["auth", "onboarding-session"]`, navigates from the returned session, and does not toast |
| stale tab clicks `Start Exploring` after onboarding already completed | `markOnboardingComplete` returns `status: "already_complete"` with the authoritative complete session and does not rerun completion side effects or fire completion analytics again; the client patches `queryKey = ["auth", "onboarding-session"]` and lands on `/dashboard` via `resolveSession()` |
| availability check operational failure | return `status: "error"`; show `Couldn't check that handle — try again.` plus inline action `Check again`; Continue stays disabled until a successful retry returns `available`. If this happens on the immediate mount-time check for a suggested seed, keep the suggested value visible and focused, show the error state immediately, hide the preview, and let the user recover by editing or retrying. After a retry settles and the step remains mounted, focus returns to the input with the caret at the end. |
| submit loses uniqueness race | return `taken` inline, stay on the step |
| RPC can't find `account` or `user_preferences` row | raise and rollback the transaction; surface as operational failure toast |
| user refreshes on `claim-handle` before submit | route resumes on `claim-handle` as normal; the persisted `phase_job_ids` are already cleared because entering `claim-handle` is the post-sync cleanup point |
| stale tab resubmits the same already-owned handle after the user has progressed later | RPC returns success, preserves the later persisted step, and the client navigates to the returned authoritative session instead of rewinding to `flag-playlists` |
| `goToStep(...)` fails after a prior step-side effect already succeeded | `useOnboardingNavigation()` returns `{ status: "transition_failed" }` without toasting; the caller restores interactivity, preserves the already-saved server state, keeps the user on the current step, and shows the step-specific post-save failure toast from §7.2 |
| submit succeeded but navigation/cache update failed client-side | next fresh guard read sees the authoritative persisted step (normally `flag-playlists` on first claim), so the user advances on reload |
| operator manually fixes a handle in SQL | allowed in v0, but the DB now rejects non-trimmed, non-lowercase, or syntactically invalid values; operator must write a trimmed lowercase valid handle |
| someone visits `/@missing-handle` | the public route throws `notFound()` |
| someone visits `/@Fabio` | redirect to the canonical lowercase route `/@fabio` before lookup |
| someone visits a malformed lowercase route like `/@foo..bar`, `/@foo%20bar`, or `/@@foo` | do **not** repair or redirect it; let the lowercase lookup miss and fall through to `notFound()` |
| public handle lookup hits an operational failure | throw and let the normal error boundary render; do not fake a not-found |
| someone visits `/@existing-handle` before public sharing ships | render the minimal public coming-soon page, not Settings and not an authenticated redirect |
| someone visits `/@existing-handle` right after claim but before onboarding is complete | the route is not live yet and throws `notFound()` |
| `VITE_PUBLIC_APP_ORIGIN` has a trailing slash | trim it before building preview URLs |
| provider-specific profile data is missing | handle claim still works; passive prefill simply degrades to blank |

## 13. Rollout and deployment sequencing

### 13.1 Rollout model

- no feature flag
- schema first, app second
- pre-prod means no production backfill path is needed for this rollout

### 13.2 Recommended order

1. add `VITE_PUBLIC_APP_ORIGIN` to env/public config files
2. create migration for `account.handle` + unique handle index + format check constraint
3. create migration for `claim_handle(UUID, TEXT)` RPC
4. run `bun run gen:types`
5. add handle domain modules (`handle-rules`, `handle-prefill`, `claim-handle-seed`, `handle-profanity`)
6. extract shared `AnalysisContent` into `src/lib/domains/enrichment/content-analysis/analysis-content.ts`, add `analysisContentSchema` + `parseAnalysisContent(...)`, and repoint existing imports/boundary parsing to that module
7. extract core onboarding session contracts into `src/lib/domains/library/accounts/onboarding-session.ts`
8. extract shared onboarding-session server primitives into `src/lib/server/onboarding-session.ts`
9. extend onboarding loader data with `claimHandleSeed`
10. add `src/lib/server/account-handle.functions.ts` with `checkHandleAvailability` and `claimHandleAndAdvance`
11. insert `claim-handle` into the onboarding machine and cleanup list
12. build `ClaimHandleStep`
13. add the minimal public `/@handle` coming-soon route
14. wire settings read-only handle display
15. update `scripts/reset-onboarding.ts` so the default replay path also clears `account.handle`, and update its CLI help/output copy accordingly
16. add tests
17. run verification:
    - `bun run test`
    - `bun run typecheck`

### 13.3 Existing accounts

Pre-prod assumption stands: there are no meaningful real accounts to migrate.

Local replay path remains:

- `bun run reset:onboarding <email>`

That command must be updated in this change so the default reset clears both:

- `user_preferences` onboarding state
- `account.handle`

Without clearing `account.handle`, local replay would only exercise the stale re-entry/owned-handle path and would no longer be a true first-claim onboarding reset. Update the script's help text and completion summary so that behavior is explicit.

Do not invent a backfill flow in this change.

## 14. Test plan

### 14.1 Shared rule tests

Add focused tests for:

- lowercase normalization without trimming surrounding whitespace
- valid examples:
  - `a`
  - `433`
  - `_fabio`
  - `fabio_`
  - `fabio__galiano`
  - `fabio._galiano`
  - `fabio_.galiano`
- invalid examples:
  - `.fabio`
  - `fabio.`
  - `fabio..galiano`
  - `@fabio`
  - `f@bio`
  - `fabio-galiano`
  - `fabio galiano`
  - ` fabio `
  - `fabio!`
  - `""`
  - length 31
- `isReservedHandle(normalizedHandle)` reserved-word detection after successful format validation
- precedence is stable when multiple format rules fail:
  - `@help` => `contains_at_sign`
  - `help.` => `trailing_period`
  - `.help` => `leading_period`
  - `foo..` => `consecutive_periods`
  - `foo .` => `invalid_chars`
  - `.help.` => `leading_period`
- `contains_at_sign` is returned specifically for `@` anywhere in the visible value
- onboarding-step helper behavior:
  - `compareOnboardingSteps(...)`
  - `isOnboardingStepBefore(...)`
  - `getPreviousOnboardingStep(...)`
  - `getNextOnboardingStep(...)`
  - `getNextOnboardingStep("plan-selection") === "complete"`
  - `getPreviousOnboardingStep("complete") === "plan-selection"`
  - `SAVEABLE_ONBOARDING_STEP_VALUES` excludes `"complete"` but includes `"song-walkthrough"` and `"match-walkthrough"`
  - `SAVEABLE_ONBOARDING_STEPS.safeParse("complete").success === false`
  - `clearsSyncPhaseJobIds(...)`, including `claim-handle => true` and pre-sync steps => `false`
- onboarding-session domain behavior in `src/lib/domains/library/accounts/onboarding-session.ts`:
  - `sessionMode(...)`
  - `claim-handle` is categorized as `"steps"`
  - missing handle outranks a non-null `onboarding_completed_at` and still resolves to `claim-handle`
- route-mapping behavior in `src/features/onboarding/step-resolver.ts`:
  - unfinished steps resolve to `/onboarding`
  - `song-walkthrough` resolves to `/liked-songs`
  - `match-walkthrough` resolves to `/match`
  - `complete` resolves to `/dashboard`

### 14.2 Passive prefill tests

Test:

- `Fábio Galiano` → `fabio_galiano`
- punctuation collapse to `_`
- edge underscore trimming
- 30-char truncation
- empty-after-normalization → blank
- existing `account.handle` wins over display-name-derived prefill

### 14.3 Analysis-content boundary tests

Test `src/lib/domains/enrichment/content-analysis/analysis-content.ts` for:

- valid stored analysis JSON parses into `AnalysisContent`
- malformed/non-object JSON logs and returns `null`
- callers keep existing wrapper contracts and collapse invalid parsed content to `analysis = null` instead of producing partial objects with `content: null`
- wrong-shaped nested fields log and return `null`
- callers touched by this change no longer rely on unchecked `as AnalysisContent` casts for raw DB JSON
- onboarding walkthrough/session loading degrades invalid analysis rows to `analysis: null` instead of throwing

### 14.4 Profanity tests

Test server profanity handling for:

- plain blocked words
- separator-obfuscated forms using `.` and `_`
- default non-profane examples that should pass under the library's built-in behavior

### 14.5 Server contract tests

Test `checkHandleAvailability`:

- `available`
- self-owned exact match returns `available` without reserved/profanity/taken checks
- `empty`
- `contains_at_sign`
- `invalid_chars` for surrounding whitespace
- `taken`
- `reserved`
- `profanity`
- `already_owned` authoritative stale-recovery branch with `ownedHandle` + `OnboardingAuthPayload`
- `error` on forced operational failure

Test `claimHandleAndAdvance`:

- success returns authoritative `ownedHandle` plus fresh `OnboardingAuthPayload`
- success path derives both from the fresh `ownedHandle` returned after a successful claim, not stale `context.account.handle`
- `validateHandleFormatInput(raw)` lowercases, never trims, returns `contains_at_sign` before `invalid_chars`, and returns canonical `normalizedHandle` only on success
- `isReservedHandle(normalizedHandle)` runs only after format validation and blocks first-claim attempts without blocking the self-owned exact-match grandfather path
- `empty` returns `{ status: "unavailable", reason: "empty" }`
- first claim attempt from an earlier step returns `status: "not_ready"` with the authoritative pre-claim `OnboardingAuthPayload`
- first claim on a completion-stamped but handle-less row returns `status: "claimed"` with an authoritative post-claim `OnboardingAuthPayload` whose `session.status` is `complete`, not `flag-playlists`
- first claim canonicalizes a prematurely saved later valid step — including the inconsistent `complete`-without-timestamp case — back to `flag-playlists` and clears `phase_job_ids`
- first claim from an invalid/unknown unfinished step token returns `status: "not_ready"` rather than being treated as later-step-allowed
- same-handle idempotent re-entry from `claim-handle` advances to `flag-playlists`
- same-handle exact-match re-entry bypasses reserved/profanity checks and still succeeds idempotently
- same-handle stale re-entry after a later saved step returns that later `OnboardingAuthPayload` without rewinding it
- `invalid_chars` for surrounding whitespace before any `already_owned` branch
- pre-RPC caller-account mismatch returns `status: "already_owned"` with `ownedHandle` + authoritative `OnboardingAuthPayload` when the account already has a different handle
- structured RPC row `{ status: "already_owned", owned_handle }` maps into the authoritative submit-time `status: "already_owned"` branch
- `taken` on unique-race loser
- structured RPC row `{ status: "not_ready", owned_handle: null }` maps to `status: "not_ready"`
- malformed or missing RPC success data throws
- non-`23505` failures throw

Test `markOnboardingComplete`:

- `plan-selection` with an existing handle returns `{ status: "completed_now", onboarding }` and the returned `OnboardingAuthPayload.session.status` is `complete`
- a stale/earlier authoritative session returns `{ status: "not_ready", onboarding }` and does **not** complete
- a handle-less later-step or completion-stamped row that the shared session loader collapses to `claim-handle` returns `status: "not_ready"` rather than completing
- already-complete re-entry returns `{ status: "already_complete", onboarding }` without rerunning completion side effects
- operational failures still throw
- as with `claimHandleAndAdvance`, post-mutation session reconstruction must not reuse stale middleware account-handle state

### 14.6 RPC / DB integration tests

Test:

- successful first claim returns `{ status: "claimed", owned_handle: <handle> }` and writes both tables
- first claim from `welcome`, `pick-color`, `install-extension`, or `syncing` returns `{ status: "not_ready", owned_handle: null }`
- first claim after `user_preferences.onboarding_step = 'pick-demo-song'` returns `{ status: "claimed", owned_handle: <handle> }`, rewrites `onboarding_step` to `flag-playlists`, and clears `phase_job_ids`
- first claim after `user_preferences.onboarding_step = 'complete'` with `onboarding_completed_at = NULL` returns `{ status: "claimed", owned_handle: <handle> }`, rewrites `onboarding_step` to `flag-playlists`, and clears `phase_job_ids`
- first claim after `user_preferences.onboarding_completed_at IS NOT NULL` and a missing handle returns `{ status: "claimed", owned_handle: <handle> }`, preserves the completion timestamp, and does **not** rewrite `onboarding_step` to `flag-playlists`
- first claim from an invalid/unknown unfinished `user_preferences.onboarding_step` returns `{ status: "not_ready", owned_handle: null }`
- same-handle rerun on the same account while still on `claim-handle` returns `{ status: "claimed", owned_handle: <handle> }` and is idempotent
- same-handle rerun after `user_preferences.onboarding_step = 'pick-demo-song'` returns `{ status: "claimed", owned_handle: <handle> }` and leaves `onboarding_step` unchanged
- second claim with a different handle on the same account returns `{ status: "already_owned", owned_handle: <existingHandle> }`
- DB uniqueness is enforced on canonical stored `handle` values (plain unique index on `handle`)
- DB rejects manual writes with uppercase, surrounding whitespace, leading/trailing period, or consecutive periods
- concurrent claims across different accounts: exactly one wins
- forced missing `user_preferences` row causes the RPC to raise and rollback
- forced missing `account` row causes the RPC to raise and rollback

### 14.7 Component tests

Test `ClaimHandleStep` behavior for:

- `suggested` seed mount triggers immediate availability check
- `blank` seed mount shows helper and disabled Continue
- Continue stays disabled for every non-actionable state: blank, format-invalid, reserved, unchecked debounce-gap, checking, availability error, and edited-away owned state
- `owned` seed mount shows `Using your current handle.`, skips availability, and enables Continue
- editing away from an `owned` seed value disables Continue, shows `Your handle is already @handle.`, and offers reset action `Use @handle`
- Enter / submit while an owned seed is edited away from the owned value is a no-op: it does not auto-reset, does not run availability, and does not submit a claim
- activating the reset action restores the owned handle, restores owned-handle status, and returns focus to the input
- local invalid period states show specific inline messages on claimable values
- stale server-returned `empty` uses the dynamic status region to show `Enter a handle to continue.`
- ordinary local empty editing keeps the static helper visible and leaves the dynamic status region empty
- if a defensive blank submit path somehow fires despite disabled CTA gating, it uses that same dynamic `empty` message
- visible `@` anywhere in the field shows `Don’t include @ — it’s added to your public URL.`
- overlength input remains visible, shows `Handles can be up to 30 characters.`, and is not silently truncated by the input element
- invalid local claimable states suppress availability checks
- 250ms debounce behavior
- Enter / submit during the unchecked debounce gap does not bypass debounce or start an immediate availability request
- overlapping availability requests for older values never overwrite the current value's status or CTA gating
- operational availability error blocks Continue, shows inline retry action `Check again`, and retrying reruns availability for the same visible value without relying on a cached prior verdict
- after a retry settles and the step remains mounted, focus returns to the input with the caret at the end
- if a suggested seed's immediate mount-time check fails operationally, the field keeps that visible suggested value, shows the inline error state immediately, keeps focus in the input, hides the preview, and clears back to the neutral debounce-gap state as soon as the user edits
- Enter / submit while the current visible value is already checking does not start a duplicate availability request
- input becomes `readOnly` during submit (not `disabled`) and keeps the submitted value visible
- late availability results do not overwrite submit-time UI state while the submit request is in flight
- expected submit failures restore input editability, keep the submitted value in place, return focus to the input with the caret at the end, and stay inline rather than toasted
- out-of-order submit returns `status: "not_ready"`, updates only `queryKey = ["auth", "onboarding-session"]`, and navigates from the returned authoritative session without toasting or patching `account.handle`
- stale-tab availability recovery for a different already-owned handle returns `status: "already_owned"`, patches both `queryKey = ["auth", "onboarding-session"]` and `queryKey = ["auth", "session"]` with `ownedHandle`, and navigates immediately without requiring submit
- stale-tab submit for a different already-owned handle returns the same authoritative `status: "already_owned"` shape if a stale client somehow reaches submit, patches both caches, and navigates without toasting
- operational submit failure restores input editability, keeps the submitted value, returns focus to the input, and toasts
- success updates both `queryKey = ["auth", "onboarding-session"]` and `queryKey = ["auth", "session"]` using the returned `ownedHandle` + `onboarding`, then navigates from the returned authoritative session without calling `saveOnboardingStep`
- stale-tab same-handle success does not force `/onboarding?step=flag-playlists`
- if stale-tab same-handle success returns `session.status = "complete"`, navigation resolves to `/dashboard`, not `/liked-songs`
- preview shows full host + path only for owned or availability-confirmed values; it stays hidden for unchecked, checking, unavailable, error, and edited-away owned states
- accessibility wiring (`form`, `label`, `aria-describedby`, static helper id, dynamic status id, `aria-live` only on the dynamic status region)
- Enter in the focused handle input submits via native form behavior; no `useShortcut("enter")` dependency

### 14.8 Guard, navigation-hook, and settings tests

Test:

- `useOnboardingNavigation()` returns `{ status: "transitioned" }` on success and `{ status: "transition_failed" }` on save/fetch/navigate failure
- `useOnboardingNavigation()` does not toast internally on `transition_failed`; caller components own the user-facing toast copy
- `WelcomeStep` re-enables its CTA and shows `Couldn't continue. Please try again.` when `goToStep("pick-color")` returns `{ status: "transition_failed" }`
- `PickColorStep` distinguishes theme-save failure from transition failure; after a successful `saveThemePreference(...)`, a failed `goToStep("install-extension")` shows `Your theme was saved, but we couldn't continue. Please try again.` instead of a save-theme error
- `InstallExtensionStep` shows `Sync started, but we couldn't continue. Refresh to keep going.` when sync startup succeeded but the transition to `syncing` failed, and it restores `isAdvancing`
- `FlagPlaylistsStep` shows `Your playlist preferences were saved, but we couldn't continue. Please try again.` when playlist save succeeded but the transition to `pick-demo-song` failed, and it restores `isSaving`
- sync completion navigates to `claim-handle`, not `flag-playlists`, and does not depend on passing `syncStats` through router state
- `SyncingStep` shows `Sync finished, but we couldn't continue. Refresh to keep going.` if the post-sync transition fails, and it does not repeatedly auto-retry on a steady completed sync state
- `FlagPlaylistsStep` no longer depends on `location.state?.syncStats`
- handle-less user is pinned to `claim-handle` even if `user_preferences.onboarding_step` was manually set to `flag-playlists`, `pick-demo-song`, `complete`-without-timestamp, another later step, or the row already has `onboarding_completed_at`
- `getOnboardingSession()` and `getOnboardingData()` return the same authoritative `session.status` for handle-less later-step or completion-stamped rows; the full onboarding payload must not lag behind the guard session
- `/onboarding` skip-ahead checks use the shared step-order helper semantics rather than ad-hoc index math
- dev workflow prev/next navigation follows the shared helper-derived step order after inserting `claim-handle`
- `saveOnboardingStep` rejects `step: "complete"` at its transport boundary; completion must go through `markOnboardingComplete()`
- `saveOnboardingStep` also rejects `"song-walkthrough"` / `"match-walkthrough"` when `demo_song_id` is missing, so generic step saving cannot create invalid walkthrough rows; once `demo_song_id` exists, walkthrough re-entry remains allowed
- `PickDemoSongStep` continues to use `commitDemoSongAndEnterWalkthrough({ spotifyTrackId })` for first entry into `song-walkthrough`, not generic step saving
- dev workflow direct navigation into a walkthrough step without `demo_song_id` fails without writing the invalid step
- dev workflow forward navigation into `complete` calls `markOnboardingComplete()`, not `saveOnboardingStep({ step: "complete" })`, and follows the returned authoritative onboarding session instead of assuming completion
- dev workflow rewinding away from `complete` intentionally uses an earlier `saveOnboardingStep(...)` target and clears `onboarding_completed_at`
- `PlanSelectionStep` completion success patches `queryKey = ["auth", "onboarding-session"]` from the returned payload and navigates via `resolveSession()`, not a hardcoded `/dashboard` push
- `PlanSelectionStep` fires `analytics.capture("onboarding_completed", ...)` only on `status: "completed_now"`, not on `already_complete` or `not_ready`
- stale/out-of-order `markOnboardingComplete` returning `status: "not_ready"` patches `queryKey = ["auth", "onboarding-session"]`, navigates to the returned authoritative step, and does not toast
- after first-claim success, guard allows progression to `flag-playlists`
- after successful claim, same-session navigation to Settings reads the patched `queryKey = ["auth", "session"]` cache and shows `@handle` without a reload
- after successful claim, same-session navigation to the authenticated shell sidebar and Dashboard header reads the patched `queryKey = ["auth", "session"]` cache and shows `@handle` without a reload
- stale same-handle re-entry does not rewind a later saved step
- Settings Account section treats `@handle` as the primary displayed identity and does not render `account.display_name` as the displayed name in v0
- Sidebar and Dashboard header also treat `@handle` as the displayed identity and do not fall back to `account.display_name` or `account.email` in v0

### 14.9 Public `@handle` route tests

Test:

- `/@handle` resolves publicly without requiring auth
- uppercase or mixed-case `/@Handle` requests redirect to canonical lowercase `/@handle`
- an existing handle whose owner completed onboarding renders the coming-soon page with `@handle`
- an existing handle whose owner has not completed onboarding still throws `notFound()`
- the route becomes live only after onboarding completion; claiming a handle alone is not enough
- `imageUrl` null degrades gracefully on that page, with avatar initials derived from the handle
- the page does not render a secondary provider `display_name` line
- a missing handle throws `notFound()`
- a lookup/query failure throws and does not get coerced into `notFound()`
- the route does not redirect to `/settings` or `/login`
- the route loader calls `getPublicHandleIdentity(...)`, not the admin-query module directly
- only `handle` and `image_url` are selected/exposed for the coming-soon page, and the query helper maps `image_url` to `imageUrl`

## 15. Resolved decisions

- handle lives on `account`
- DB enforces trimmed lowercase storage plus the basic syntax subset via `account_handle_format_check`
- syntax follows Instagram-like username rules
- allowed chars: letters, numbers, periods, underscores
- disallowed: hyphens, spaces, other symbols
- periods cannot lead, trail, or repeat as `..`
- underscores may lead, trail, repeat, and sit next to periods
- all-digit handles are allowed
- app-language, policy, auth, and official-sounding names remain reserved even when they would not technically collide with the current `/@handle` router namespace
- handle claim is a required onboarding step after `syncing`
- shared `AnalysisContent` lives in `src/lib/domains/enrichment/content-analysis/analysis-content.ts`, not under `src/features/liked-songs/`
- `analysis-content.ts` owns the read-path runtime schema (`analysisContentSchema`) and boundary parser (`parseAnalysisContent(value): AnalysisContent | null`), but it is explicitly a seam over the existing content-analysis schema family rather than a third unrelated schema authority; malformed stored analysis JSON is logged and degraded to `null`, not trusted via unchecked casts or surfaced as a page-breaking exception
- that degradation happens at the outer wrapper level (`analysis = null`), not by widening walkthrough-specific or liked-song analysis wrapper fields to nullable `content`
- core onboarding session contracts (`WalkthroughSongAnalysis`, `WalkthroughSong`, `OnboardingSession`, `OnboardingAuthPayload`, `sessionMode`) live in `src/lib/domains/library/accounts/onboarding-session.ts`
- `src/features/onboarding/step-resolver.ts` is a thin route-mapping module over those shared session contracts; new server/shared modules must not import session types from `src/features/...`
- app-side onboarding order helpers live in `src/lib/domains/library/accounts/onboarding-steps.ts`; route guards, devtools navigation, and sync-cleanup branching read those helpers instead of reimplementing step order
- first-claim submits from earlier onboarding steps are rejected server-side as `status: "not_ready"`; route/UI guards are not the only enforcement layer
- the DB-side `claim_handle` RPC mirrors the same pre-claim ordering rule in SQL, returns structured status rows for expected outcomes (`claimed`, `already_owned`, `not_ready`), and is locked by integration tests
- onboarding gating is authoritative on `account.handle`, not only on the saved `onboarding_step` token
- guard-critical and full onboarding loaders reuse the same handle-aware session derivation helper; `getOnboardingSession()` and `getOnboardingData()` must not disagree about `session.status`
- when `account.handle` is null, that prerequisite outranks later step tokens **and** even an existing non-null `onboarding_completed_at`; the user is still pinned to `claim-handle` until the handle exists
- onboarding officially ends after plan-selection success marks `session.status = "complete"`
- `markOnboardingComplete()` is a structured server contract that returns `{ status: "completed_now" | "already_complete" | "not_ready", onboarding: OnboardingAuthPayload }`; it may only complete from the authoritative `plan-selection` session, and already-complete re-entry is idempotent
- stale or premature completion attempts recover by navigating from the returned authoritative onboarding session instead of forcing `/dashboard` or toasting
- the canonical destination for `session.status = "complete"` is `/dashboard`, and `resolveSession()` is the single authority for that mapping
- `complete` remains part of helper-visible onboarding order for prev/next reasoning, but `SAVEABLE_ONBOARDING_STEP_VALUES` / `SaveableOnboardingStep` intentionally exclude it; completion itself is only entered via `markOnboardingComplete()`, and neither `updateOnboardingStep(...)` nor `saveOnboardingStep(...)` may accept `"complete"`
- walkthrough steps remain in `SAVEABLE_ONBOARDING_STEP_VALUES` for re-entry only; `saveOnboardingStep(...)` may not write `"song-walkthrough"` or `"match-walkthrough"` unless `demo_song_id` already exists
- `commitDemoSongAndEnterWalkthrough({ spotifyTrackId: string })` remains the only valid first-entry mutation from `pick-demo-song` into `song-walkthrough`
- successful claim must patch both onboarding-session and auth-session client caches so same-session Settings reads show the newly owned handle immediately
- authoritative availability-time `status: "already_owned"` recovery must patch those same caches with `ownedHandle` + returned onboarding state before navigation
- authoritative submit-time `status: "already_owned"` recovery must patch those same caches with `ownedHandle` + returned onboarding state before navigation
- v0 includes a minimal public `/@handle` coming-soon route without exposing sharing data yet
- TanStack Router's mixed static+dynamic segment syntax is valid here, so the public route intentionally uses `src/routes/@{$handle}.tsx` with `createFileRoute('/@{$handle}')`
- on read surfaces introduced or updated by this change — Settings, the authenticated shell sidebar, the Dashboard header, and the public `/@handle` page — the handle is the displayed identity; `account.display_name` remains a passive prefill/input source, not the public-facing name
- the previewed `Public URL` in onboarding is display-only, not clickable
- the public `/@handle` route distinguishes missing-handle not-found from operational lookup failure; only the former becomes `notFound()`
- the canonical public handle URL is lowercase; mixed-case requests redirect to the lowercase route before lookup
- public-route canonicalization is case-only; malformed lowercase inputs are not repaired and simply fall through to `notFound()`
- the public `/@handle` coming-soon page goes live only after onboarding completion
- v0 has **no generated suggestion system**
- claim step receives `ClaimHandleSeed` so the client can distinguish owned, suggested, and blank states without guessing
- terminology is explicit: `owned` means this account already owns the handle, `claimed` is reserved for successful claim mutation results, and `taken` remains the user-correctable “another account already has this handle” reason
- the shared `ClaimHandleSeed` contract and `deriveClaimHandleSeed({ accountHandle, displayName })` helper live in `src/lib/domains/library/accounts/claim-handle-seed.ts`; `src/lib/server/onboarding.functions.ts` consumes them but does not own them
- handle rules intentionally split shared format validation from reserved-word policy: `validateHandleFormatInput(raw)` owns lowercase/no-trim format checks, and `isReservedHandle(normalizedHandle)` owns namespace blocking after format validation
- live input transformation is lowercase-only; whitespace, overlength input, and other invalid characters stay visible and are handled by validation, not silent stripping or truncation
- step may passively prefill from normalized `account.display_name`
- passive prefill uses `_` between normalized word chunks
- if passive prefill is taken, keep it visible and show unavailable state on mount
- local validation gates the button before availability does
- availability checks debounce at 250ms, run immediately on valid prefill mount, and use an account-scoped React Query key (`accountId` + `ownedHandleSnapshot` + `debouncedHandle`) plus no-result-reuse query settings so edit-away/edit-back flows force a fresh live check without cross-account or pre-claim/post-claim cache bleed
- expected failures are shown inline, not via toast
- operational availability failures block Continue and expose an inline retry action for the same value
- ordinary unavailable availability and submit failures reuse the same reason enum; authoritative `already_owned` recovery is a separate status branch
- first successful claim canonicalizes the next persisted onboarding step to `flag-playlists` only for unfinished onboarding rows; completion-stamped handle-less rows instead preserve completion and resolve back to `complete` after claim
- same-handle stale re-entry must not rewind onboarding; the server preserves any later step and the client navigates from the returned authoritative session
- self-owned exact-match checks are grandfathered in v0: after local format validation passes, they bypass reserved-word and profanity policy checks so immutable existing handles do not strand users
- availability-time stale recovery for a different already-owned handle uses a dedicated authoritative `status: "already_owned"` branch with `ownedHandle` + `OnboardingAuthPayload`, patches caches, and navigates immediately rather than disabling Continue on an inline unavailable error
- submit-time stale recovery for a different already-owned handle uses the same dedicated authoritative `status: "already_owned"` branch if a stale client somehow reaches submit
- both handle server functions share one transport-only `handleInputSchema = z.object({ handle: z.string() })`; semantic rules like `empty` and `too_long` stay in the format validator, and reserved-word blocking stays in `isReservedHandle(normalizedHandle)`, not the Zod transport schema
- sync `phase_job_ids` are cleared on entry to `claim-handle`, preserving the old “clear once you leave syncing” behavior, and the `claim_handle` success path defensively clears them again whenever it canonicalizes unfinished onboarding forward to `flag-playlists`
- `syncStats` stay DB-derived in `OnboardingData`; do not duplicate them through router state once `claim-handle` is inserted
- `useOnboardingNavigation()` returns structured `{ status: "transitioned" | "transition_failed" }` results and does not toast internally; onboarding step components own state reset and the exact user-facing failure copy
- `useStepNavigation()` keeps its existing async/pending/toast behavior, but its target type narrows to `SaveableOnboardingStep`; only `/onboarding`-scoped step navigation adopts the new result-returning contract
- read-only settings display is included in v0
- the default `bun run reset:onboarding <email>` replay path must clear `account.handle` so local onboarding replay still covers first-claim behavior
- self-serve renames are out of scope in v0
- operator/manual correction remains allowed as a DB-only escape hatch, but still passes through the DB normalization/syntax constraints
- no feature flag
- no dedicated handle-specific rate limiting in v0
- no handle-specific analytics in v0
- canonical public-link origin comes from env-backed `VITE_PUBLIC_APP_ORIGIN`
- public-link construction lives in one shared cross-runtime module: `src/lib/config/public-app-origin.ts`, which reads `VITE_PUBLIC_APP_ORIGIN` from `src/env.public.ts`
- public `@handle` route loaders go through `src/lib/server/public-handle.functions.ts`; route files must not import admin-client account queries directly
- production public origin is `https://hearted.music`
