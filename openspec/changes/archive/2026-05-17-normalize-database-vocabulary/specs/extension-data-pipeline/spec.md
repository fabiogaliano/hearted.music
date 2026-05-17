## MODIFIED Requirements

### Requirement: Extension Authentication via Bearer Token

The system SHALL authenticate extension requests using a bearer token obtained through `externally_connectable` handoff and persisted as hashed rows in `extension_api_token`.

#### Scenario: Extension receives API token from web app
- **WHEN** the user connects the extension during onboarding or from settings
- **THEN** the web app sends an API token to the extension via `chrome.runtime.sendMessage`
- **AND** the extension stores the token in `chrome.storage.local`
- **AND** the backend stores only the token hash in `extension_api_token`

#### Scenario: Extension sends authenticated request
- **WHEN** the extension calls `/api/extension/sync` or `/api/extension/status`
- **THEN** it includes the API token as `Authorization: Bearer <token>` header
- **AND** the backend validates the token against `extension_api_token` and resolves the associated account

#### Scenario: Extension request without valid token
- **WHEN** the extension sends a request without a valid bearer token
- **THEN** the backend returns HTTP 401
- **AND** the extension reports the user needs to reconnect from the web app

#### Scenario: Token revocation
- **WHEN** the user disconnects the extension or the token is revoked
- **THEN** the backend marks the relevant `extension_api_token` rows revoked
- **AND** the extension removes the token from `chrome.storage.local`
- **AND** subsequent requests fail with HTTP 401
