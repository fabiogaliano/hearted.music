## ADDED Requirements

### Requirement: Schema-driven env var definition
All application environment variables SHALL be defined in a single `.env.schema` file at the project root using `@env-spec` decorator syntax. Each variable definition SHALL include its type (`@type`), sensitivity (`@sensitive`), and requirement status (`@required` or inferred from having a default value).

#### Scenario: Schema defines all application env vars
- **WHEN** a developer inspects `.env.schema`
- **THEN** every env var used by the application is listed with its type, sensitivity, and requirement decorators

#### Scenario: Schema is the single source of truth
- **WHEN** a new env var is needed
- **THEN** it is added only to `.env.schema` (not duplicated in a TypeScript file or `.env.example`)

### Requirement: Type-safe ENV access object
All application code SHALL access environment variables via `import { ENV } from 'varlock/env'` instead of `process.env` or `import.meta.env` (except Vite built-ins like `import.meta.env.DEV`). The `ENV` object SHALL be fully typed based on the schema.

#### Scenario: Server code accesses env var
- **WHEN** server-side code needs `SUPABASE_URL`
- **THEN** it imports `ENV` from `'varlock/env'` and reads `ENV.SUPABASE_URL` with correct type

#### Scenario: Direct process.env access is eliminated
- **WHEN** searching `src/` for `process.env.<APP_VAR>` (excluding Vite built-ins and test setup)
- **THEN** zero matches are found

#### Scenario: Client code accesses public env var
- **WHEN** client-side code needs `VITE_CHROME_EXTENSION_ID`
- **THEN** it reads `ENV.VITE_CHROME_EXTENSION_ID` from the `ENV` object

### Requirement: Auto-generated TypeScript types
The system SHALL auto-generate an `env.d.ts` file from `.env.schema` using varlock's `@generateTypes` decorator. The generated file SHALL provide full IntelliSense for the `ENV` object.

#### Scenario: Types are generated from schema
- **WHEN** `varlock typegen` is run
- **THEN** `env.d.ts` is created/updated at the path specified in the `@generateTypes` decorator

#### Scenario: Types stay in sync with schema
- **WHEN** a new variable is added to `.env.schema`
- **AND** `varlock typegen` is run
- **THEN** the new variable appears in `env.d.ts` with the correct TypeScript type

### Requirement: Vite plugin integration
The varlock Vite plugin SHALL be configured in `app.config.ts` with `ssrInjectMode: 'resolved-env'` for Cloudflare Workers compatibility. The plugin SHALL handle build-time replacement of non-sensitive public variables and runtime injection for server variables.

#### Scenario: Vite dev server loads env vars
- **WHEN** the dev server starts via `bun run dev`
- **THEN** varlock validates all required env vars and reports errors for missing ones

#### Scenario: Production build for Workers
- **WHEN** the app is built for Cloudflare Workers deployment
- **THEN** env vars are resolved at build time via `resolved-env` mode and the bundle contains no `process.env` references

### Requirement: Sensitive variable protection
Variables marked `@sensitive` in the schema SHALL NOT be exposed to client-side code. Varlock SHALL enforce this boundary at build time.

#### Scenario: Sensitive var blocked from client bundle
- **WHEN** client-side code attempts to access a `@sensitive` variable
- **THEN** varlock raises a build-time or validation error

#### Scenario: Non-sensitive public vars available on client
- **WHEN** a variable is prefixed with `VITE_` and not marked `@sensitive`
- **THEN** it is available in client-side code via the `ENV` object

### Requirement: Validation on startup
Varlock SHALL validate all environment variables against the schema on application startup. Missing required variables or type mismatches SHALL cause a clear error with the variable name and expected type.

#### Scenario: Missing required variable
- **WHEN** `SUPABASE_URL` is not set and is marked `@required`
- **THEN** varlock reports a validation error naming `SUPABASE_URL` and its expected type

#### Scenario: All variables present and valid
- **WHEN** all required variables are set with correct types
- **THEN** the application starts without env validation errors

### Requirement: Leak scanning in CI
A `varlock scan` step SHALL be available as a pre-commit hook and CI check to detect leaked sensitive values in source files.

#### Scenario: Pre-commit hook catches leaked secret
- **WHEN** a staged file contains a value matching a `@sensitive` env var
- **THEN** `varlock scan --staged` exits non-zero and reports the leak location

#### Scenario: Clean codebase passes scan
- **WHEN** no source files contain sensitive env var values
- **THEN** `varlock scan` exits zero

### Requirement: Legacy env infrastructure removed
The `@t3-oss/env-core` dependency and `src/env.ts` file SHALL be removed. All imports of `@/env` SHALL be replaced with `import { ENV } from 'varlock/env'`.

#### Scenario: No t3-env references remain
- **WHEN** searching the codebase for `@t3-oss/env-core` or `createEnv`
- **THEN** zero matches are found (excluding `node_modules` and changelogs)

#### Scenario: No src/env.ts file exists
- **WHEN** checking `src/env.ts`
- **THEN** the file does not exist
