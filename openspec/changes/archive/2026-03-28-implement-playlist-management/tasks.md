## 1. Route-facing playlist read model

- [x] 1.1 Add authenticated playlist-management read functions in `src/lib/server/playlists.functions.ts` for the `/playlists` list view and selected-playlist track preview, reusing `src/lib/domains/library/playlists/queries.ts` and the song data modules instead of onboarding loaders.
- [x] 1.2 Add playlist-management query keys/query options in `src/features/playlists/queries.ts` and preload the list query from `src/routes/_authenticated/playlists.tsx` with a route loader.
- [x] 1.3 Add tests for the new read boundaries in `src/lib/server/__tests__/playlists.functions.test.ts` or an equivalent test module, covering populated, empty-library, and missing-track-preview cases.

## 2. Warm-pastel `/playlists` UI surface

- [x] 2.1 Replace the placeholder route in `src/routes/_authenticated/playlists.tsx` with a feature-backed route that renders a dedicated playlist-management screen inside the existing authenticated shell.
- [x] 2.2 Create the core feature modules in `src/features/playlists/` for the matching-playlists rail, available-library list, and warm-pastel empty/loading/reconnect states, preserving the audited prototype structure without barrel exports.
- [x] 2.3 Create the detail-surface components in `src/features/playlists/` for playlist inspection, description editing, track preview, and close behavior, including honest states when playlist tracks are empty or unavailable.
- [x] 2.4 Add component tests in `src/features/playlists/__tests__/` covering split-view rendering, target-rail empty state, detail open/close, and track-preview unavailable messaging.

## 3. Target membership mutations and session staging

- [x] 3.1 Add route-specific target-membership mutations in `src/lib/server/playlists.functions.ts` that reuse `setPlaylistTarget(...)` from `src/lib/domains/library/playlists/queries.ts` without reusing onboarding's immediate-refresh mutation path.
- [x] 3.2 Implement `/playlists` session state in `src/features/playlists/` so repeated add/remove actions always reflect the latest user intent and can temporarily overlay query-backed server state during the mounted session.
- [x] 3.3 Extend `src/lib/workflows/library-processing/types.ts`, `src/lib/workflows/library-processing/service.ts`, and a new helper such as `src/lib/workflows/library-processing/changes/playlist-management.ts` with one manual playlist-management flush boundary that records coalesced target-affecting facts once per route session.
- [x] 3.4 Add route-exit and `pagehide` flush coverage in `src/features/playlists/__tests__/` and `src/lib/workflows/library-processing/__tests__/`, verifying that React unmount/navigation-away is the primary path and that only one downstream refresh request is emitted per session.

## 4. Extension-backed metadata editing

- [x] 4.1 Add client-side extension status and command orchestration in `src/features/playlists/` using `src/lib/extension/detect.ts`, `src/lib/extension/spotify-client.ts`, and the acknowledgement capability from `openspec/changes/add-playlist-write-acknowledgement/`, either through a tiny browser helper or direct route-local composition for the supported playlist metadata edit flow.
- [x] 4.2 Add a confirmed-write acknowledgement path in `src/lib/server/playlists.functions.ts` plus any needed update helper in `src/lib/domains/library/playlists/queries.ts` so successful extension metadata edits are persisted into app DB state without waiting for a later full sync.
- [x] 4.3 Add pending-reconciliation, reconnect-required, and failed-write UI states in `src/features/playlists/`, with tests in `src/features/playlists/__tests__/` that confirm the route never pretends a failed or unavailable extension write succeeded.

## 5. Query invalidation and downstream refresh integration

- [x] 5.1 Wire playlist-management mutations and the acknowledgement capability from `openspec/changes/add-playlist-write-acknowledgement/` to invalidate/refetch the new playlist-management queries in `src/features/playlists/queries.ts` and the route code in `src/routes/_authenticated/playlists.tsx`.
- [x] 5.2 Ensure the exit-time playlist-management flush integrates with the existing background-refresh invalidation behavior driven by `src/lib/hooks/useActiveJobs.ts`, so matching-session reads update after the coalesced downstream work settles.
- [x] 5.3 Add integration coverage for refresh-trigger classification in `src/lib/workflows/library-processing/__tests__/` or equivalent tests, including membership changes, target-affecting metadata edits, and non-target-only edits.

## 6. Validation

- [x] 6.1 Review the finished route against `old_app/prototypes/warm-pastel/features/playlists/*` and `old_app/prototypes/warm-pastel/DESIGN-GUIDANCE.md`, confirming parity for layout, copy, interactions, and honest adaptation states.
- [x] 6.2 Run `bun run test` and the smallest relevant additional check for the new route/server boundaries before applying the change.
