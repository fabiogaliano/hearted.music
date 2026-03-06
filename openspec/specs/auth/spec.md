# auth Specification

## Purpose
Authenticate users via Better Auth with social OAuth providers (Google) and manage DB-backed sessions.

## Requirements

### Requirement: Social OAuth Login

The system SHALL authenticate users via Better Auth with Google social OAuth.

#### Scenario: User initiates Google login
- **WHEN** user clicks "Sign in with Google" on the login page
- **THEN** `authClient.signIn.social({ provider: "google" })` redirects to Google consent screen
- **AND** after approval, Google redirects to `/api/auth/callback/google`
- **AND** Better Auth creates or links user record
- **AND** Better Auth sets session cookie
- **AND** user is redirected to dashboard (or onboarding if first login)

#### Scenario: User denies OAuth access
- **WHEN** user denies access on the provider's consent screen
- **THEN** Better Auth handles the error callback
- **AND** user is redirected to login page with error message

---

### Requirement: Session Management

The system SHALL manage user sessions via Better Auth's DB-backed sessions.

#### Scenario: Session created on login
- **WHEN** social OAuth flow completes successfully
- **THEN** Better Auth creates a `session` record in the database
- **AND** sets an HTTP-only session cookie (`better-auth.session_token`)
- **AND** cookie is marked Secure in production
- **AND** cookie has SameSite=Lax attribute

#### Scenario: Session validated on request
- **WHEN** an authenticated route or server function is accessed
- **THEN** system calls `auth.api.getSession({ headers })` with request headers
- **AND** Better Auth looks up the session token in the database
- **AND** verifies session has not expired
- **AND** returns the associated user data

#### Scenario: Session expired
- **WHEN** session token references an expired session
- **THEN** `auth.api.getSession()` returns null
- **AND** user is redirected to login

#### Scenario: Session destroyed on logout
- **WHEN** user triggers logout via `authClient.signOut()`
- **THEN** Better Auth deletes the session record from database
- **AND** clears the session cookie
- **AND** user is redirected to landing page

---

### Requirement: Account Record Creation

The system SHALL create an app account record when a user first authenticates.

#### Scenario: New user first login
- **WHEN** a user completes social OAuth for the first time
- **THEN** Better Auth creates a `user` record (email, name, image)
- **AND** the system creates an `account` record with `better_auth_user_id` referencing the Better Auth user
- **AND** `spotify_id` is left NULL (populated on first extension sync)
- **AND** `display_name` and `email` are copied from the Better Auth user

#### Scenario: Returning user login
- **WHEN** an existing user logs in again
- **THEN** Better Auth finds the existing user record
- **AND** creates a new session
- **AND** the `account` record is not modified

---

### Requirement: Auth Route Handler

The system SHALL expose Better Auth endpoints via a catch-all API route.

#### Scenario: Auth API requests
- **WHEN** any request hits `/api/auth/*`
- **THEN** the catch-all route at `src/routes/api/auth/$.ts` forwards it to `auth.handler(request)`
- **AND** Better Auth handles sign-in, sign-up, callback, session, and sign-out endpoints

---

### Requirement: Logout

The system SHALL allow users to log out via Better Auth.

#### Scenario: User logs out
- **WHEN** user triggers `authClient.signOut()`
- **THEN** Better Auth deletes the session from the database
- **AND** clears the session cookie
- **AND** user is redirected to landing page
