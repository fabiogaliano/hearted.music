# Pick Demo Song — Story Index

> Source of truth: [`docs/pick-demo-song-plan.md`](../../pick-demo-song-plan.md)

## Stories

| ID | Title | Depends on | Status |
|----|-------|------------|--------|
| PDS-01 | Foundation: migration, seed script, demo match data extraction | — | todo |
| PDS-02 | Server layer: save selection, update showcase/match RPCs, remove env var | PDS-01 | todo |
| PDS-03 | UI + wiring: PickDemoSongStep, step config, navigation, route loader | PDS-02 | todo |

## Dependency graph

```
PDS-01  →  PDS-02  →  PDS-03
```

Strictly linear — each story builds on the previous. No parallel work.

## Story files

- [PDS-01-foundation.md](./PDS-01-foundation.md)
- [PDS-02-server-layer.md](./PDS-02-server-layer.md)
- [PDS-03-ui-wiring.md](./PDS-03-ui-wiring.md)

---

## Dependency Map

### 1. Story dependency graph

```
PDS-01 (foundation)
  │
  ▼
PDS-02 (server layer)
  │
  ▼
PDS-03 (UI + wiring)
```

Single linear chain. No fan-out, no fan-in.

| Story | Explicit depends-on | Implicit depends-on (file overlap) |
|-------|--------------------|------------------------------------|
| PDS-01 | — | — |
| PDS-02 | PDS-01 (migration, `demo-matches.ts`) | PDS-01 creates `demo-matches.ts` that PDS-02 imports |
| PDS-03 | PDS-02 (server function types, `isDemo` on `DemoMatchResult`) | PDS-02 modifies `onboarding.functions.stub.ts` that PDS-03 also modifies |

### 2. Critical path

```
PDS-01 → PDS-02 → PDS-03
```

All three stories are on the critical path. Total chain length: 3. There are no off-critical-path stories.

### 3. Shared-contract stories that must land first

**PDS-01** is the shared-contract story. It produces two artifacts consumed by both later stories:

| Artifact | Consumers |
|----------|-----------|
| `src/lib/data/demo-matches.ts` (types + `getDemoMatchesForSong`) | PDS-02 (server import), PDS-03 (client timeout fallback) |
| `src/lib/data/database.types.ts` (regenerated with `demo_song_id`) | PDS-02 (preferences queries read the column) |

PDS-01 **must merge before any other story starts**.

### 4. Hot files / merge-risk zones

| File | Touched by | Risk | Notes |
|------|-----------|------|-------|
| `src/__mocks__/onboarding.functions.stub.ts` | PDS-02 (add `saveDemoSongSelection` stub), PDS-03 (may update stubs for new step) | **Low** — sequential chain, no parallel branches | Different sections of the file; PDS-02 adds a stub, PDS-03 may reference it |
| `src/lib/data/demo-matches.ts` | PDS-01 (creates), PDS-02 (imports), PDS-03 (imports) | **None** — PDS-01 creates, later stories only import | No conflicting edits |
| `src/lib/domains/library/accounts/preferences-queries.ts` | PDS-02 (reads `demo_song_id` via existing queries), PDS-03 (modifies `ONBOARDING_STEPS` enum) | **Low** — different sections | PDS-02 doesn't edit this file, only PDS-03 does |
| `src/lib/server/onboarding.functions.ts` | PDS-02 only | **None** — single owner | |
| `src/features/onboarding/Onboarding.tsx` | PDS-03 only | **None** — single owner | |

**Verdict:** No real merge-risk zones exist because the chain is strictly sequential. If stories were parallelized (which they shouldn't be — see §6), `onboarding.functions.stub.ts` would be the only conflict point.

### 5. Parallelizable story groups

**None.** Every story has a hard dependency on the previous:

- PDS-02 imports `getDemoMatchesForSong` from the module PDS-01 creates
- PDS-02 queries `demo_song_id` from the column PDS-01's migration adds
- PDS-03 consumes `isDemo` on `DemoMatchResult` that PDS-02 introduces
- PDS-03 calls `saveDemoSongSelection` that PDS-02 creates

There is no safe way to run any two stories in parallel branches.

### 6. Stories that must NOT run in parallel

| Pair | Reason |
|------|--------|
| PDS-01 ∥ PDS-02 | PDS-02 imports from `demo-matches.ts` (created by PDS-01) and queries `demo_song_id` (PDS-01 migration). Would not compile. |
| PDS-02 ∥ PDS-03 | PDS-03 consumes `DemoMatchResult.isDemo` and `saveDemoSongSelection` (both created by PDS-02). Would not compile. Types from PDS-02 define the contract PDS-03 implements. |
| PDS-01 ∥ PDS-03 | Transitive — PDS-03 depends on PDS-02 which depends on PDS-01. |

### 7. Recommended implementation waves

This is a single-wave, sequential implementation.

| Wave | Stories | Start condition | Merge strategy |
|------|---------|----------------|----------------|
| **Wave 1** | PDS-01 | Immediately | Branch from `main`, merge to `main` |
| **Wave 2** | PDS-02 | After PDS-01 merges | Branch from `main` (with PDS-01), merge to `main` |
| **Wave 3** | PDS-03 | After PDS-02 merges | Branch from `main` (with PDS-01 + PDS-02), merge to `main` |

**Alternative — stacked PRs on a feature branch:**

If you want all three PRs open for review simultaneously:

```
main ← feature/pick-demo-song ← pds-01 ← pds-02 ← pds-03
```

- Open PDS-01 PR against `feature/pick-demo-song`
- Open PDS-02 PR against PDS-01 branch
- Open PDS-03 PR against PDS-02 branch
- Merge inward: PDS-01 → PDS-02 → PDS-03 → feature branch → main

This lets review happen in parallel even though implementation is sequential.

**No batching benefit:** With only 3 stories in a linear chain, there's no time savings from parallelism. Optimize for fast iteration — merge each story quickly and move to the next.
