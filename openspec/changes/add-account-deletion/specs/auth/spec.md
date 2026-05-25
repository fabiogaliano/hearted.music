## ADDED Requirements

### Requirement: Sessions Revoked on Deletion Confirmation

The system SHALL revoke all of a user's Better Auth sessions when account deletion is confirmed, signing the user out on every device.

#### Scenario: Deletion confirmed
- **WHEN** a user follows a valid account-deletion confirmation link
- **THEN** the system revokes all `session` records for that Better Auth user
- **AND** subsequent requests carrying a revoked session cookie are treated as unauthenticated

---

### Requirement: Pending-Deletion Access Routing

The system SHALL route authenticated access for an account in the `pending_deletion` state to the account-restore screen instead of the application, while keeping sign-in itself available so the account remains recoverable.

#### Scenario: Pending-deletion user signs in
- **WHEN** a user whose account has a non-null `deletion_requested_at` signs in
- **THEN** sign-in succeeds and a session is created
- **AND** the `_authenticated` guard routes them to the account-restore screen rather than the dashboard or app routes

#### Scenario: Pending-deletion user reaches an app route
- **WHEN** a user with a `pending_deletion` account navigates directly to an authenticated app route
- **THEN** the system redirects them to the account-restore screen

#### Scenario: Same email cannot re-register during grace
- **WHEN** the email of a `pending_deletion` account is used to sign in again before purge
- **THEN** the existing Better Auth user is matched (no duplicate account is created)
- **AND** the user lands on the account-restore screen
