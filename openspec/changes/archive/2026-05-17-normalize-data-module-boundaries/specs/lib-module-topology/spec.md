## MODIFIED Requirements

### Requirement: Canonical `src/lib` top-level structure

The system SHALL organize core library modules under a canonical topology composed of `src/lib/domains`, `src/lib/workflows`, `src/lib/integrations`, `src/lib/platform`, `src/lib/shared`, `src/lib/content`, and infrastructure-only `src/lib/data`.

#### Scenario: New core module placement
- **WHEN** a new core library module is created
- **THEN** it SHALL be placed under one of the canonical top-level folders based on business ownership, platform role, content role, or low-level database infrastructure role

#### Scenario: Database infrastructure exception
- **WHEN** a module only provides Supabase client setup, generated database types, or low-level database adapter setup
- **THEN** it MAY reside under `src/lib/data`
- **AND** it SHALL NOT expose business-domain query operations, platform workflow policy, or static app content

#### Scenario: Legacy implementation-layer folders retired
- **WHEN** the lib reorganization is complete
- **THEN** new modules SHALL NOT be introduced under legacy implementation buckets such as `src/lib/capabilities`, `src/lib/jobs`, `src/lib/ml`, or general-purpose `src/lib/data` repositories

## ADDED Requirements

### Requirement: Persistence modules are owned by domain or platform capability

The system SHALL place persistence and query modules with the bounded context or platform capability that owns their business meaning.

#### Scenario: Domain-owned query placement
- **WHEN** a module reads or writes data whose behavior belongs to a business domain such as library, billing, enrichment, or taste
- **THEN** it SHALL reside under the owning `src/lib/domains/<domain>/**` module tree
- **AND** callers SHALL import it from that domain module rather than from `src/lib/data`

#### Scenario: Platform-owned persistence placement
- **WHEN** a module reads or writes data for cross-cutting infrastructure such as auth tokens, jobs, scheduling, or worker support
- **THEN** it SHALL reside under the owning `src/lib/platform/<capability>/**` module tree
- **AND** callers SHALL import only the role-specific platform module they need

#### Scenario: No compatibility data wrappers
- **WHEN** a persistence or query module moves out of `src/lib/data`
- **THEN** the old `src/lib/data/*` path SHALL NOT remain as a re-export wrapper
- **AND** consumers SHALL import directly from the new owning module

### Requirement: Static app content lives under content modules

The system SHALL place static JSON-backed app content and content transformation helpers under `src/lib/content` instead of `src/lib/data`.

#### Scenario: Legal content placement
- **WHEN** code exposes bundled FAQ, privacy, or terms content to routes or features
- **THEN** that module SHALL reside under `src/lib/content/**`
- **AND** it SHALL NOT be presented as database data

#### Scenario: Landing/demo content placement
- **WHEN** code exposes bundled landing-song manifests, landing-song detail helpers, or demo match data
- **THEN** that module SHALL reside under `src/lib/content/landing/**`
- **AND** server-only bundled loaders SHALL remain explicit in their module names rather than hidden behind a barrel export
