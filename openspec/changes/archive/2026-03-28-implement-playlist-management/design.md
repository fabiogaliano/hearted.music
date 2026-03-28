## Context

The current production route at `src/routes/_authenticated/playlists.tsx` is still a centered “Coming Soon” placeholder. That is out of step with the rest of the codebase:

- `src/routes/_authenticated/route.tsx` already provides the authenticated shell, theme registration, sidebar layout, and active-job invalidation hooks the route would live inside.
- `src/routes/_authenticated/-components/Sidebar.tsx` already exposes `/playlists` as a first-class navigation destination alongside Home, Match Songs, and Liked Songs.
- `src/lib/theme/colors.ts`, `src/lib/theme/fonts.ts`, `src/lib/theme/useTheme.ts`, and `src/lib/theme/ThemeHueProvider.tsx` already implement the same warm-pastel theme system the legacy prototype used.
- `src/lib/domains/library/playlists/queries.ts` already stores synced playlist rows, `is_target`, images, descriptions, song counts, and `playlist_song` membership.
- `src/routes/api/extension/sync.tsx` already persists playlist metadata and playlist-track membership from the extension, and `src/lib/workflows/spotify-sync/playlist-sync.ts` preserves `is_target` across sync upserts.
- `src/lib/extension/detect.ts` and `src/lib/extension/spotify-client.ts` already provide browser-runtime extension detection plus typed Spotify write commands.
- `src/lib/workflows/library-processing/service.ts`, `src/lib/workflows/library-processing/types.ts`, and `src/lib/workflows/library-processing/reconciler.ts` already own downstream enrichment / match-refresh scheduling after onboarding and sync.
- `src/lib/hooks/useActiveJobs.ts` already invalidates matching queries when `matchSnapshotRefresh` settles.

The warm-pastel prototype under `old_app/prototypes/warm-pastel/features/playlists` is also unusually complete. The audit shows a clear intended information architecture:

- `Playlists.tsx`: two-pane layout with a sticky left target rail and browseable right library.
- `sections/ActivePlaylistsPanel.tsx`: “Matching Playlists” heading, count, and an empty-state message.
- `sections/PlaylistLibrary.tsx`: “Available Library · N” list with row-level add actions.
- `components/PlaylistDetailView.tsx`: right-column detail overlay with large art, title, editable description, track count, and matching toggle.
- `components/PlaylistDescription.tsx`: inline edit / save / cancel and “+ Add description” affordance.
- `components/PlaylistTrackList.tsx`: track preview as part of the browsing/detail flow.
- `hooks/usePlaylistExpansion.ts`: FLIP/view-transition opening and closing behavior.
- `ARCHITECTURE.md`: explicit split between active playlists, available library, and overlay detail.

The prototype is therefore the primary UX source of truth, but the current app architecture imposes real constraints:

1. Playlist data only exists after extension sync populates app tables.
2. Browser extension status detection is client-only because it depends on `chrome.runtime.sendMessage` in `src/lib/extension/detect.ts`.
3. Spotify-owned playlist writes are browser-runtime extension commands, not server-side Spotify SDK calls.
4. The inspected code did **not** originally include a dedicated server boundary that acknowledges extension playlist writes back into app DB state. That gap is now intentionally split into a separate prerequisite OpenSpec change, `add-playlist-write-acknowledgement`, so `/playlists` can consume a clean server acknowledgement capability instead of inventing its own persistence path.
5. Onboarding already owns the initial target-selection moment through `src/features/onboarding/components/FlagPlaylistsStep.tsx` and `src/lib/server/onboarding.functions.ts`.
6. The current library-processing control plane eagerly requests refresh when onboarding or sync says targets changed; it does not yet have a route-session batching concept for `/playlists`.

This design therefore needs to preserve prototype parity where the current app already supports it, adapt prototype behavior where the app shape differs, and explicitly redesign the parts the current code does not yet support.

## Goals / Non-Goals

**Goals:**
- Turn `/playlists` into a real, warm-pastel playlist-management route grounded in the audited prototype.
- Reuse the existing authenticated shell, sidebar, theme system, playlist tables, extension command layer, and job invalidation patterns already present in the codebase.
- Define an explicit read model for playlist browsing and detail inspection that fits TanStack Start route loaders and query patterns.
- Define immediate-feeling target management without immediate downstream refresh after every action.
- Define one coalesced exit-time flush path for target-affecting changes, with React unmount/navigation-away as the primary reliable path and `pagehide` as best-effort fallback.
- Define honest Spotify-owned metadata-edit behavior that depends on the browser extension and does not pretend backend reconciliation exists where the current code has not implemented it yet.
- Preserve onboarding ownership of initial target selection while making `/playlists` the long-lived post-onboarding management surface.

**Non-Goals:**
- Replacing onboarding’s `flag-playlists` step or changing onboarding progression.
- Introducing server-side Spotify OAuth writes or any server attempt to call `chrome.runtime.sendMessage`.
- Rebuilding the authenticated shell, sidebar IA, or theme system.
- Adding speculative playlist create/delete flows that the prototype does not define and the current inspected route architecture does not yet need.
- Replacing extension sync as the primary source of playlist and playlist-track ingestion.
- Moving background refresh ownership out of the existing library-processing / match-snapshot-refresh architecture.

## Decisions

### Decision: Preserve the prototype’s IA almost verbatim, but classify reuse vs adaptation vs redesign explicitly

The production route should keep the prototype’s core shape:

- left sticky rail for current matching playlists
- right browse list for the wider library
- detail view anchored to the browse column
- editorial typography and muted monochrome theme
- prototype empty-state copy and priorities wherever the current app can support them honestly

#### Reuse directly

These pieces already match the prototype closely enough to reuse without conceptual redesign:

- authenticated shell and sidebar framing in `src/routes/_authenticated/route.tsx` and `src/routes/_authenticated/-components/Sidebar.tsx`
- warm-pastel themes and fonts in `src/lib/theme/colors.ts` and `src/lib/theme/fonts.ts`
- playlist storage primitives in `src/lib/domains/library/playlists/queries.ts`
- extension status and command wrappers in `src/lib/extension/detect.ts` and `src/lib/extension/spotify-client.ts`
- active-job invalidation pattern in `src/lib/hooks/useActiveJobs.ts`

#### Adapt

These prototype behaviors should remain, but they need adaptation to the current architecture:

- the prototype’s mock playlist-track preview becomes a read against synced `playlist_song` + song data
- the prototype’s “matching” toggle becomes the current app’s `is_target` management behavior
- the prototype’s detail editing affordance becomes extension-backed Spotify metadata editing with route-aware pending states
- the prototype’s route content must fit inside the existing authenticated shell instead of the old prototype dashboard wrapper

#### Redesign

These areas cannot be copied directly because the current app does not yet support them as-is:

- post-write DB reconciliation after a successful extension playlist write
- route-session staging of target-affecting changes before downstream refresh
- any reuse of onboarding’s current `savePlaylistTargets(...)` mutation, because it immediately triggers background processing

The alternative was to either copy the prototype literally or to redesign `/playlists` from scratch around current backend constraints. Literal copying would hide real architecture gaps. Starting over would throw away a strong, already-audited UX. This design keeps the prototype’s IA and rewrites only the unsupported seams.

### Decision: Add route-specific playlist read and mutation boundaries instead of reusing onboarding boundaries

`src/lib/domains/library/playlists/queries.ts` is a low-level DB module, not a route-facing query or mutation API. `src/lib/server/onboarding.functions.ts` is also the wrong reuse point because its target-selection behavior is onboarding-scoped and immediately calls `applyLibraryProcessingChange(...)`.

The implementation for this change should therefore introduce `/playlists`-specific server boundaries and query options instead of reusing onboarding code paths. Concretely, the route will need:

- a route loader in `src/routes/_authenticated/playlists.tsx` that preloads playlist-management data
- new route-facing server functions for playlist reads and per-action mutations, likely in a dedicated module such as `src/lib/server/playlists.functions.ts`
- new query keys / query options for playlist list state and detail-track reads, analogous to `src/features/matching/queries.ts` and `src/features/liked-songs/queries.ts`

This keeps route loading at the route boundary, follows the existing TanStack Start query pattern, and avoids coupling `/playlists` to onboarding-specific mutation semantics.

This route change should also own the client-side integration seam that the acknowledgement prerequisite deliberately leaves open:

- browser-side composition of extension commands plus playlist acknowledgement calls
- playlist-query invalidation and refetch after acknowledged writes

That work belongs here because the query module and the route consumers do not exist yet in the current codebase. The prerequisite `add-playlist-write-acknowledgement` change should provide the server capability, while `/playlists` decides whether to call that capability through a tiny browser helper or directly from route-local orchestration.

The alternative was to reuse `getOnboardingData()` or `savePlaylistTargets()` from `src/lib/server/onboarding.functions.ts`. That would pull onboarding-only concerns into a long-lived route and would violate the new requirement to avoid per-action downstream refresh.

### Decision: Separate immediate playlist-state updates from downstream refresh triggering

The user’s intent inside `/playlists` should be reflected immediately, but downstream match publication should be coalesced. Those are two different concerns and should be modeled separately.

#### Immediate state changes

Successful route actions should update the current playlist-management session immediately:

- target membership changes should update visible route state without a separate save screen
- supported extension-backed metadata edits should update visible route state immediately after the extension confirms success

#### Staged downstream refresh

A route-scoped session accumulator should separately record whether the mounted `/playlists` session has introduced target-affecting changes that require a later refresh. The accumulator is not a draft of all playlist data. It is a coarse “published matches are now stale” fact set.

Conceptually, the route needs to track at least:

- whether target membership changed
- whether target-affecting metadata changed
- which local optimistic changes still need backend reconciliation

The exit flush should then emit one route-session-level manual change into the existing background-processing architecture instead of directly ensuring jobs from the UI.

The alternative was to stage all writes until navigation-away. That would be fragile, would risk losing user changes on tab close, and would diverge sharply from the prototype’s immediate-feeling add/remove flow. The other alternative—triggering downstream refresh after each action—was explicitly rejected by the requested behavior.

### Decision: Model `/playlists` exit flush as one new library-processing source boundary

The current code already routes background freshness through `applyLibraryProcessingChange(...)` in `src/lib/workflows/library-processing/service.ts`. `/playlists` should extend that architecture, not bypass it.

Implementation for this change should therefore add one explicit manual playlist-management source boundary, for example:

- a new `LibraryProcessingChange` variant in `src/lib/workflows/library-processing/types.ts`
- a corresponding helper such as `src/lib/workflows/library-processing/changes/playlist-management.ts`
- one route-exit server boundary that submits the coalesced target-affecting facts once per mounted session

That lets `/playlists` fit the same scheduling ownership model currently used by onboarding and sync, while changing the *timing* of the trigger to session-exit rather than per action.

The alternative was to have `/playlists` call lower-level job ensure helpers directly. That would bypass the very control plane that already owns background refresh scheduling and would create a third orchestration style alongside onboarding and sync.

### Decision: Use extension commands for Spotify-owned metadata edits, then persist confirmed outcomes back into app DB state

The inspected write path in `src/lib/extension/spotify-client.ts` already exposes `updatePlaylist(...)`, and the extension side already handles it through `extension/src/background/command-handler.ts` plus `extension/src/shared/spotify-client/playlist-v2.ts`. That is the correct execution path for Spotify-owned playlist metadata changes.

However, the inspected app code does not yet have a `/playlists` route consumer that wires extension command success to app-state updates and cache invalidation. The prerequisite `add-playlist-write-acknowledgement` change is intended to supply the server acknowledgement boundary, and this route change should supply the client-side orchestration that consumes it.

This change should therefore define a two-step orchestration for supported metadata edits:

1. browser route calls the extension command via `src/lib/extension/spotify-client.ts`
2. after a successful command response, the app calls the playlist acknowledgement boundary and invalidates/refetches the relevant playlist-management queries immediately

That second step is the redesign point this route needs. It is still consistent with the architecture because the browser owns the Spotify write, the server only acknowledges a confirmed outcome, and the route owns the cache behavior of its own query layer.

The alternative was to wait for a later full extension sync to reconcile playlist metadata. That would keep the backend truthful, but it would make route behavior feel sloppy and would not preserve the prototype’s direct-edit affordance. The other alternative—server-side Spotify writes—would contradict the inspected browser-extension architecture.

### Decision: Load playlist-track preview data on demand for the selected playlist

The prototype only needs one expanded playlist at a time. The current DB queries also separate playlist rows from `playlist_song` membership in `src/lib/domains/library/playlists/queries.ts`.

The route should therefore preload the playlist list at entry and fetch expanded track detail only for the selected playlist. This aligns with the prototype’s single-detail focus and avoids loading every playlist’s track membership up front.

This implies a route-facing read boundary that composes:

- playlist row data
- `playlist_song` rows from `getPlaylistSongs(...)`
- enough song metadata to render a preview list

The alternative was to eager-load all playlist tracks for the whole library. That is unnecessary for the prototype flow and would make the route heavier than the current interaction model requires.

### Decision: Use React navigation-away / unmount as the primary flush path and `pagehide` as fallback

The current app already has a close-enough precedent in `src/features/matching/hooks/useMatchingSession.ts`, which accumulates presented songs and flushes on unmount plus browser lifecycle events.

`/playlists` should follow the same broad stance—session accumulation with fire-and-forget exit flush—but with one explicit change required by this spec:

- React navigation-away / route unmount is the primary reliable path
- `pagehide` is the best-effort fallback for tab close, reload, or browser exit
- the route should not rely on browser teardown hooks alone

This balances the user requirement with browser reality. The alternative—depending entirely on `pagehide` / unload—would be less reliable for ordinary in-app navigation. The alternative of having no browser-lifecycle fallback would lose too many tab-close and reload cases.

## Risks / Trade-offs

- [Extension-write acknowledgement is new work] → Keep Spotify writes in the browser extension, then add a minimal server acknowledgement boundary for confirmed outcomes instead of pretending sync-only reconciliation is sufficient.
- [Exit-time flush is best-effort on hard page teardown] → Treat React unmount/navigation-away as the primary path, use `pagehide` only as fallback, and make stale published matches recoverable through later qualifying triggers.
- [Immediate route state can diverge from query-backed state temporarily] → Make the session overlay explicit in route data flow and invalidate/refetch after mutation success, reconciliation, and background refresh completion.
- [Prototype track preview is richer than today’s route-facing read model] → Add an on-demand detail read boundary instead of overloading the initial list query.
- [Concurrent extension sync and `/playlists` edits may race] → Route all downstream freshness through one coalesced library-processing boundary and prefer latest confirmed user intent when reconciling visible route state.
- [There is an active OpenSpec change for library-processing in this repo] → Land implementation in coordination with `refactor-library-processing-control-plane`, because this route depends on the on-disk control-plane code already present under `src/lib/workflows/library-processing/*`.

## Migration Plan

1. Add `/playlists`-specific read-model/server boundaries and query keys that compose the existing playlist tables into route-facing data without reusing onboarding loaders.
2. Replace the placeholder `src/routes/_authenticated/playlists.tsx` route with a loader-backed route that renders a dedicated playlist-management feature module inside the authenticated shell.
3. Implement immediate target-membership mutations against app data without using onboarding’s immediate-refresh mutation path.
4. Implement the extension-backed metadata-edit flow plus a server acknowledgement boundary that persists confirmed playlist metadata outcomes into app DB state.
5. Add route-session staging and one exit-time manual library-processing flush boundary so target-affecting changes request downstream refresh once per mounted `/playlists` session.
6. Hook the route into existing query invalidation and active-job completion behavior so matching/session state refreshes when the coalesced downstream work settles.
7. Validate the finished implementation against the audited prototype states: split layout, empty states, detail inspection, edit affordance, extension-missing guidance, and session-exit refresh behavior.

Rollback strategy is straightforward before implementation ships because the current route is still a placeholder. Once implementation begins, the safest rollback is to restore the placeholder route rather than partially ship a route that performs extension writes without the acknowledgement and exit-flush pieces.

## Open Questions

- No design-blocking product questions remain for the spec artifacts.
- Implementation should explicitly coordinate with the still-active library-processing OpenSpec change so `/playlists` does not introduce a second refresh-orchestration path while that control-plane work is in flight.
