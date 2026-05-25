-- Durable analytics/replay consent for authenticated users. The cookie remains
-- the source of truth for anonymous users and the fast client cache; these
-- columns let a logged-in user's decision survive a lost cookie for up to 12
-- months. Expiry is derived from consent_updated_at at read time (no stored
-- expires_at) to avoid drift, and consent_version lets a future policy change
-- force re-consent for DB-backed authenticated users without another schema
-- migration. Anonymous users stay cookie-only and are re-asked when that
-- cookie expires.

alter table public.user_preferences
  add column consent_status text,
  add column consent_updated_at timestamptz,
  add column consent_version integer;

alter table public.user_preferences
  add constraint user_preferences_consent_status_check
    check (
      consent_status is null
      or consent_status in ('granted', 'denied')
    ),
  -- Either no decision is recorded at all, or all three fields are present.
  -- Keeps reads from ever seeing a half-written decision.
  add constraint user_preferences_consent_triplet_check
    check (
      (
        consent_status is null
        and consent_updated_at is null
        and consent_version is null
      )
      or
      (
        consent_status is not null
        and consent_updated_at is not null
        and consent_version is not null
      )
    );
