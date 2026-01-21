## MODIFIED Requirements

### Requirement: Service module location

The system SHALL place Spotify integration modules under `src/lib/integrations`.

#### Scenario: Spotify service organization
- **WHEN** Spotify service modules are created or updated
- **THEN** they are located under `src/lib/integrations/spotify`

#### Scenario: Existing integration module relocation
- **WHEN** a Spotify integration module exists outside `src/lib/integrations`
- **THEN** it is moved into `src/lib/integrations` and imports are updated
