## Why

`/playlists` is still a placeholder even though the app already syncs playlist rows and playlist tracks from the extension, already stores target-playlist state on `playlist.is_target`, and already uses the same warm-pastel theme and authenticated shell the legacy prototype was built around. The repo also contains a much richer warm-pastel playlist-management prototype in `old_app/prototypes/warm-pastel/features/playlists`, so we need a production spec that preserves that experience while adapting honestly to the current extension-backed sync, route-loading, and background-refresh architecture.

## What Changes

- Replace the placeholder `/playlists` route with a spec for a warm-pastel playlist-management experience: sticky “Matching Playlists” rail, “Available Library” browse list, expandable detail view, track preview, and prototype-parity empty/loading/error copy where practical.
- Define how `/playlists` reads synced playlist and playlist-track data from the current app architecture, fits inside the authenticated shell/sidebar, and reuses the existing theme, typography, query, and background-job invalidation patterns already present in `src/routes/_authenticated/*`, `src/lib/theme/*`, and `src/lib/hooks/useActiveJobs.ts`.
- Define route-local interaction behavior for playlist target toggling and Spotify-owned metadata edits, including optimistic UI, extension-required states, honest failure/reconnect states, and explicit distinctions between what can be reused directly from the prototype, what must be adapted, and what must be redesigned for the current app.
- Make `/playlists` the integration point that ties the route to the extension write layer: it SHALL consume the prerequisite playlist write acknowledgement capability, own the browser-side command orchestration needed by the route, and own playlist-query invalidation/refetch behavior after acknowledged writes.
- Make coalesced downstream refresh behavior explicit: target-affecting changes during a `/playlists` session SHALL be staged locally, SHALL NOT trigger downstream matching refresh after every action, and SHALL flush one refresh request on navigation away / React unmount with best-effort `pagehide` fallback for tab close, reload, or browser exit.
- Keep initial target selection ownership in onboarding. The new `/playlists` route covers post-sync, post-onboarding playlist management rather than replacing onboarding’s `flag-playlists` step.
- Call out extension-backed Spotify write assumptions explicitly. Current inspected code exposes browser-runtime extension commands for add/remove/create/update/delete in `src/lib/extension/spotify-client.ts`, but the inspected backend only persists playlist metadata through extension sync flows today, so post-write reconciliation is an explicit design concern in this change.

## Capabilities

### New Capabilities
- `playlist-management`: Real `/playlists` route behavior for browsing synced playlists, managing matching targets, inspecting playlist details and tracks, editing supported playlist metadata through the extension-backed Spotify write path, and preserving the warm-pastel prototype’s information architecture and interaction priorities.

### Modified Capabilities
- `data-flow`: Route-level playlist loading, client-side session staging for target-affecting playlist changes, optimistic playlist-management state, and navigation/unmount/pagehide flush behavior.
- `target-playlist-match-refresh`: `/playlists` becomes a new manual trigger source whose target-affecting changes are coalesced per route session and flushed once on exit instead of requesting refresh after each individual action.

## Affected specs

- New spec: `playlist-management`
- Modified spec: `data-flow`
- Modified spec: `target-playlist-match-refresh`

## Impact

- Affected code: `src/routes/_authenticated/playlists.tsx`, `src/routes/_authenticated/route.tsx`, `src/routes/_authenticated/-components/Sidebar.tsx`, `src/lib/domains/library/playlists/queries.ts`, `src/lib/extension/spotify-client.ts`, `src/lib/extension/detect.ts`, `src/routes/api/extension/status.tsx`, `src/routes/api/extension/sync.tsx`, `src/lib/workflows/library-processing/service.ts`, `src/lib/workflows/library-processing/types.ts`, `src/lib/server/onboarding.functions.ts`, `src/lib/server/matching.functions.ts`, and likely new `/playlists`-specific feature, query, and server-function modules.
- Affected systems: authenticated route loading, playlist query/read models, extension detection and Spotify command execution, extension sync reconciliation, target-playlist refresh triggering, active-job invalidation, and warm-pastel themed UI composition.
- UX impact: `/playlists` becomes a real management surface instead of “Coming Soon,” while preserving the prototype’s warm-pastel browsing flow and being explicit about current architecture limits such as extension dependency and post-write DB reconciliation.
