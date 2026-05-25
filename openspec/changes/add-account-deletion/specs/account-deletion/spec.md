## ADDED Requirements

### Requirement: Deletion Entry Point in Settings

The system SHALL provide a self-service account-deletion entry point within the Settings page, in a visually distinct danger zone separate from routine settings.

#### Scenario: User opens the danger zone
- **WHEN** an authenticated user views the Settings page
- **THEN** a danger-zone section presents a "Delete account" action
- **AND** the action is visually separated from the routine settings sections
- **AND** activating it opens a confirmation dialog rather than deleting immediately

---

### Requirement: Subscription Gate

The system SHALL block a deletion request while the account holds an active or ending paid subscription, and direct the user to cancel via the Stripe customer portal first.

#### Scenario: Deletion requested with an active subscription
- **WHEN** a user requests account deletion while `subscriptionStatus` is `active` or `ending`
- **THEN** the system refuses to start the deletion flow
- **AND** the UI explains the subscription must be cancelled first
- **AND** the UI links to the Stripe customer portal (`createPortalSession`)

#### Scenario: Deletion requested with no active subscription
- **WHEN** a user requests account deletion while `subscriptionStatus` is `none`, `past_due`, or `canceled`
- **THEN** the system allows the deletion flow to proceed

---

### Requirement: In-App Confirmation

The system SHALL require the user to type an exact confirmation phrase before a deletion request is dispatched, and SHALL offer a copy button for that phrase.

#### Scenario: Phrase typed correctly
- **WHEN** the user types the exact confirmation phrase in the dialog
- **THEN** the confirm button is enabled
- **AND** submitting it dispatches the deletion confirmation email

#### Scenario: Phrase not matching
- **WHEN** the typed text does not exactly match the confirmation phrase
- **THEN** the confirm button remains disabled

#### Scenario: Copy button
- **WHEN** the user activates the copy button beside the phrase
- **THEN** the confirmation phrase is copied to the clipboard

---

### Requirement: Email Confirmation Dispatch

The system SHALL send a confirmation email containing a signed, single-use, time-limited link when an in-app deletion request is submitted. The email link is the authenticating gate; no state change occurs until it is followed.

#### Scenario: Confirmation email sent
- **WHEN** a user completes the in-app confirmation
- **THEN** the system sends an account-deletion confirmation email to the account's email address
- **AND** the email contains a signed, single-use, expiring confirmation link
- **AND** the account remains `active` until the link is followed

#### Scenario: Link never followed
- **WHEN** the confirmation link is never opened or has expired
- **THEN** the account remains `active`
- **AND** no personal data is deleted

#### Scenario: Link reused after consumption
- **WHEN** a confirmation link is opened a second time after already being consumed
- **THEN** the system rejects it and reports that the request is already in progress

---

### Requirement: Deletion Confirmation Transitions Account to Pending Deletion

The system SHALL, upon a valid confirmation link, move the account to a `pending_deletion` state, record the request time, and revoke all of the user's sessions.

#### Scenario: Valid confirmation link followed
- **WHEN** a user follows a valid, unexpired confirmation link
- **THEN** the system sets `account.deletion_requested_at` to the current time
- **AND** all of the user's Better Auth sessions are revoked
- **AND** the user is shown confirmation that the account is scheduled for deletion, with the recovery deadline

---

### Requirement: 30-Day Recovery Window

The system SHALL keep a `pending_deletion` account recoverable for 30 days, during which the user can restore it and cancel the pending deletion.

#### Scenario: User restores within the window
- **WHEN** a user with a `pending_deletion` account chooses to restore it within 30 days of `deletion_requested_at`
- **THEN** the system clears `deletion_requested_at`
- **AND** the account returns to `active`
- **AND** the account is no longer eligible for purge

#### Scenario: Window not yet elapsed
- **WHEN** less than 30 days have passed since `deletion_requested_at`
- **THEN** the purge process SHALL NOT delete the account

---

### Requirement: Permanent Purge After Grace Period

The system SHALL permanently purge accounts whose `deletion_requested_at` is older than 30 days, via the background worker sweep, removing all personal data across the database, Better Auth, and PostHog.

#### Scenario: Grace period elapsed
- **WHEN** the worker sweep finds an account with `deletion_requested_at` older than 30 days
- **THEN** the system archives the account's financial records in pseudonymized form
- **AND** deletes the PostHog person identified by the account ID
- **AND** deletes the `account` row, cascading all personal app data
- **AND** deletes the Better Auth `user`, cascading sessions and OAuth accounts

#### Scenario: Purge is idempotent across sweep ticks
- **WHEN** the purge query runs on every sweep tick
- **THEN** accounts not yet past the grace period are untouched
- **AND** re-running the purge produces no errors and no duplicate side effects

---

### Requirement: Financial-Record Retention

The system SHALL retain legally-required financial records after purge in a form decoupled from personal identity, rather than cascade-deleting them with the account.

#### Scenario: Financials archived before cascade
- **WHEN** an account is purged
- **THEN** transaction amounts, currency, dates, Stripe customer and subscription identifiers, and plan are written to a retention store
- **AND** that retention record carries no `account_id` foreign key, email, or display name
- **AND** the live billing rows are then removed by the account cascade

---

### Requirement: Best-Effort Third-Party Deletion

The system SHALL treat external-service deletions (PostHog) as best-effort and non-fatal, retrying on a subsequent sweep tick if they fail, without leaving the account in an inconsistent state.

#### Scenario: PostHog deletion fails
- **WHEN** the PostHog person deletion fails during purge
- **THEN** the failure does not abort the database cascade ordering safeguards
- **AND** `deletion_requested_at` is only cleared by a fully successful purge, so the account remains eligible for retry on the next tick
