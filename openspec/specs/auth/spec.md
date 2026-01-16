# auth Specification

## Purpose
TBD - created by archiving change add-spotify-auth. Update Purpose after archive.
## Requirements
### Requirement: Spotify OAuth Login

The system SHALL authenticate users via Spotify OAuth using PKCE flow.

#### Scenario: User initiates login
- **WHEN** user visits `/auth/spotify`
- **THEN** system generates PKCE code verifier and challenge
- **AND** stores code verifier in HTTP-only cookie
- **AND** redirects to Spotify authorization URL with code challenge

#### Scenario: User approves access
- **WHEN** Spotify redirects to `/auth/callback` with authorization code
- **THEN** system verifies state parameter matches
- **AND** exchanges code for access token using code verifier
- **AND** creates or updates account in database
- **AND** creates session cookie
- **AND** redirects to dashboard

#### Scenario: User denies access
- **WHEN** Spotify redirects with error parameter
- **THEN** system displays error message
- **AND** redirects to home page

#### Scenario: State mismatch detected
- **WHEN** callback state does not match stored state
- **THEN** system rejects the request
- **AND** redirects to home with error

---

### Requirement: Token Security

The system SHALL store Spotify tokens securely server-side.

#### Scenario: Tokens stored securely
- **WHEN** user completes OAuth flow
- **THEN** access_token is stored in auth_token table
- **AND** refresh_token is stored in auth_token table
- **AND** token_expires_at is calculated and stored
- **AND** tokens are never exposed to client-side code
- **AND** tokens are only accessible via service_role

#### Scenario: Tokens isolated from identity
- **WHEN** tokens are stored
- **THEN** account table contains only identity (spotify_id, email, display_name)
- **AND** auth_token table contains only credentials (tokens, expiry)
- **AND** separation enables token rotation without touching account

---

### Requirement: Automatic Token Refresh

The system SHALL automatically refresh expired tokens.

#### Scenario: Token expired before API call
- **WHEN** Spotify API call is needed
- **AND** access_token has expired (token_expires_at < now)
- **THEN** system uses refresh_token to obtain new access_token
- **AND** updates tokens in database
- **AND** proceeds with original API call

#### Scenario: Refresh token invalid
- **WHEN** refresh token request fails
- **THEN** system clears session
- **AND** redirects user to login

---

### Requirement: Session Management

The system SHALL manage user sessions via HTTP-only cookies.

#### Scenario: Session created on login
- **WHEN** OAuth flow completes successfully
- **THEN** session ID is stored in HTTP-only cookie
- **AND** cookie is marked Secure (in production)
- **AND** cookie has SameSite=Lax attribute

#### Scenario: Session validated on request
- **WHEN** authenticated route is accessed
- **THEN** system extracts session from cookie
- **AND** verifies session is valid
- **AND** loads associated account

#### Scenario: Session destroyed on logout
- **WHEN** user submits POST to `/auth/logout`
- **THEN** session cookie is cleared
- **AND** user is redirected to home

---

### Requirement: Logout

The system SHALL allow users to log out.

#### Scenario: User logs out
- **WHEN** user submits POST to `/auth/logout`
- **THEN** session is destroyed
- **AND** session cookie is cleared
- **AND** user is redirected to landing page

---

### Requirement: Account Record

The system SHALL maintain an account record for each authenticated user.

#### Scenario: New user login
- **WHEN** user logs in for the first time
- **THEN** new account record is created
- **AND** spotify_id is stored (unique identifier)
- **AND** email is stored (if provided)
- **AND** display_name is stored (if provided)

#### Scenario: Returning user login
- **WHEN** existing user logs in again
- **THEN** account record is updated
- **AND** tokens are refreshed in auth_token table
- **AND** profile info is updated (email, display_name)

---

### Requirement: Auth Token Storage

The system SHALL store authentication tokens in a separate auth_token table.

#### Scenario: Tokens stored on login
- **WHEN** OAuth flow completes successfully
- **THEN** auth_token record is created or updated
- **AND** account_id links to the account
- **AND** access_token, refresh_token, token_expires_at are stored
- **AND** only one token set exists per account (UNIQUE constraint)

#### Scenario: Tokens updated on refresh
- **WHEN** token refresh occurs
- **THEN** existing auth_token record is updated
- **AND** new access_token replaces old
- **AND** new refresh_token replaces old (if provided by Spotify)
- **AND** token_expires_at is recalculated

#### Scenario: Tokens deleted on logout
- **WHEN** user logs out
- **THEN** auth_token record MAY be retained (for re-auth)
- **OR** auth_token record MAY be deleted (if revocation requested)

