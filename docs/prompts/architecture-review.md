# Architecture & Design Pattern Review — hearted.music

You are a principal-level software architect doing a deep inspection of this codebase. Your job is NOT to fix bugs or review a diff — it is to evaluate the architecture and the software design patterns in use, and to produce a prioritized, evidence-backed improvement plan that makes the app more stable, the UX more fluid, the code more elegant, and — above all — makes future feature development faster and safer.

## Context you must work with, not against

This is **hearted.music**, a deeply interactive fullstack music app:

- **Frontend/fullstack**: TanStack Start + TanStack Router + React Query (`@tanstack/react-start`, `react-router`, `react-query`, `zod-adapter`), React 19, deployed to **Cloudflare Workers** via wrangler. SSR with `react-router-ssr-query`.
- **Runtime & tooling**: Bun everywhere, Vite, Biome, vitest (`bun run test`), typecheck via `tsgo`. Ladle for component stories (`src/stories`).
- **Data**: Supabase (Postgres, self-hosted), generated types in `src/lib/data/database.types.ts`, Zod 4 at boundaries.
- **Background worker**: a long-running Bun process (`src/worker/`) doing polling, Postgres NOTIFY listening, job execution, sweeping, backfills — deployed via `Dockerfile.worker`.
- **Structure**: feature folders in `src/features/*` (matching, liked-songs, playlists, onboarding, dashboard, billing, settings, auth, …), domain logic in `src/lib/domains/*` (billing, enrichment, library, taste), shared infra in `src/lib/{server,shared,platform,workflows,integrations,observability}`, routes in `src/routes` (including SSE and API routes), plus a browser extension (`extensions/`) and an internal control panel (`control-panel/`) that share code via `shared/`.
- **Cross-cutting**: AI SDK (Anthropic/Google/OpenAI) pipelines, Sentry, PostHog, Stripe billing, OpenTelemetry.
- **House rules**: no barrel exports; Bun for everything; vitest for tests.

Recommendations must fit this stack. Do not propose swapping frameworks, ORMs, or hosting unless something is demonstrably broken beyond repair — the goal is to use TypeScript, TanStack, and React *better*, not differently.

## How to work

1. **Map before judging.** Read `src/routes` (route tree, loaders, server functions, SSE endpoints), 2–3 representative features end-to-end (e.g. `liked-songs`, `matching`, `onboarding`: route → loader/server fn → domain → Supabase → UI → mutation → invalidation), the `src/lib/domains/*` layer, the worker's job lifecycle (`poll.ts`, `execute.ts`, `notify-listener.ts`, `sweep.ts`), and how `shared/` is consumed by the extension and control panel. Build a mental model of the layering and data flow first.
2. **Evidence or it didn't happen.** Every finding must cite concrete files and lines (`path/to/file.ts:123`) and, where you claim a pattern is repeated, show at least 2–3 occurrences. No generic best-practice essays — if a recommendation could have been written without reading this repo, delete it.
3. **Judge patterns by their consequences.** For each issue, state what it costs in practice: a class of runtime bug, a re-render/waterfall the user feels, a place where adding a feature requires touching N files, a type hole where bad data can cross a boundary.
4. **Steelman the existing code.** If a seemingly odd pattern is actually a sound response to a constraint (Cloudflare Workers limits, Bun quirks, SSR, extension/worker code sharing), say so and leave it alone.

## Dimensions to inspect

### 1. Architecture & boundaries
- Is the `features/* ↔ lib/domains/* ↔ lib/server` layering real or leaky? Do features import each other or reach around domains into raw Supabase clients?
- Server/client boundary hygiene in TanStack Start: is server-only code (secrets, service-role clients, heavy deps) reliably kept out of the client bundle? Are server functions cohesive or a grab-bag?
- The app / worker / extension / control-panel split: is `shared/` a clean contract or a dumping ground? Is there logic duplicated between the web app and the worker that should live in one domain module?
- Where does adding a typical new feature require edits today? Propose the target shape: "a new feature should mean a folder in `features/`, a route file, and a domain module — nothing else."

### 2. TypeScript leverage
- Boundary typing: are Supabase rows (`database.types.ts`), server function inputs/outputs, route search params, SSE payloads, and worker job payloads validated with Zod and narrowed once at the edge — or do raw/`any`-ish shapes flow inward?
- Domain modeling: are states modeled as discriminated unions with exhaustive `switch` handling (job status, enrichment stages, billing states, onboarding steps), or as booleans/optional fields that permit impossible states?
- Are there hand-maintained types that drift from Zod schemas or DB types where `z.infer` / generated types should be the single source of truth?
- Generics and `as` casts: find the hotspots where the type system is being fought instead of used.

### 3. TanStack Start / Router / Query usage
- Data loading: are route loaders + `queryClient.ensureQueryData` used so navigations are fetch-ahead and SSR-hydrated, or do components fetch-on-render and waterfall?
- Query design: is there a consistent query-key factory / queryOptions-per-domain pattern, or ad-hoc keys scattered through components? How safe are invalidations after mutations?
- Mutations & fluidity: where would optimistic updates or `useMutationState` make the app feel instant (hearting a song, playlist edits) but currently round-trip? Is SSE/streamed data reconciled into the query cache or held in parallel state?
- Search params: is `@tanstack/zod-adapter` used so URL state is typed and shareable, or is UI state trapped in components where it should be in the URL?
- Server functions: input validation, error typing, and whether errors surface to the UI as typed results or thrown strings.

### 4. React patterns & rendering performance
- State placement: server state in React Query, URL state in the router, and only true UI state in components — or are there useEffect-driven sync chains, prop-drilled server data, or context misused as a store?
- Component architecture: are the interactive views (dashboard, matching, liked-songs) composed of small, named, single-purpose components, or god components? Do heavy lists virtualize? Where do animations (GSAP) fight React ownership of the DOM?
- Effects audit: find `useEffect`s that derive state, mirror props, or refetch manually — each one is a bug nursery; name the replacement (derive during render, event handler, query).
- Suspense/error boundaries: is there a deliberate loading/error strategy per route segment, or ad-hoc spinners and silent catches?

### 5. Stability & failure design
- Error handling as a system: is there a shared error type/result convention from domain → server fn → UI, or does each layer improvise? What do users see when a Supabase call, a Spotify API call, or an AI provider call fails?
- Worker resilience: job idempotency, retry/backoff policy, poison-message handling, crash recovery (`fatal-handlers.ts`, `keep-alive.ts`, `job-failure-reporting.ts`) — is the job lifecycle a state machine or implicit?
- External integrations (Spotify, Stripe, AI providers): timeouts, rate-limit handling, and whether their failure modes are contained at the integration layer or leak domain-deep.
- Observability: are Sentry/PostHog/OTel wired so a production incident is diagnosable (correlation between web request, job, and DB state), or is instrumentation decorative?

### 6. Consistency, duplication & developer velocity
- Find the 3–5 most-duplicated code shapes (e.g. Supabase fetch + map + error toast; server fn boilerplate; job definition boilerplate) and design the ONE abstraction each should collapse into — with a sketch of the abstraction's signature and one call site rewritten.
- Conventions: naming, file layout, where hooks vs domain functions vs components live — is a new contributor's "where does this go?" answerable in one sentence per artifact type?
- Testability: which seams are hard to test today (things needing a live DB or network), and what minimal interface extraction would fix that? Are Ladle stories + fixtures leveraged as the fast UI feedback loop they could be?

## Output format

1. **Executive summary** (≤1 page): the 3–4 structural truths of this codebase — what is genuinely good and must be preserved, and where the real friction is.
2. **Top 10 improvements**, ranked by leverage (impact on stability/fluidity/velocity ÷ effort). For each: the problem with file evidence, the concrete target pattern (short code sketch in this repo's idiom — no barrel exports, Bun, Zod 4, TanStack idioms), the migration path (can it be adopted incrementally, file-by-file?), and the risk of doing it.
3. **Pattern ledger**: a table of *keep* (good patterns already in use — name them so they can be enforced), *stop* (anti-patterns, with the replacement), *start* (missing patterns worth introducing).
4. **Quick wins**: changes under ~1 hour each that pay off immediately.
5. **North-star sketch**: what the ideal "add a new feature" flow looks like in this codebase after the improvements — the files created, the layers touched, and what is generated/reused vs hand-written.

Constraints on your output: be specific over comprehensive — 10 verified, high-leverage findings beat 40 shallow ones. Never recommend a pattern you haven't checked against at least one real call site in this repo. If two recommendations conflict, resolve the conflict yourself and present one position.
