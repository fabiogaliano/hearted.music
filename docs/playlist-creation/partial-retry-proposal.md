# Proposal — Safe retry for the `partial` playlist-creation state

> Status: **Proposal / not scheduled.** Ship gate is telemetry (see §7).
> Scope: the `partial` result of `createPlaylistFromDraft`. Everything else in the
> create flow (`success`, `created-unsynced`, `reconnect-required`,
> `extension-unavailable`) is already handled.

## 1. Context

Playlist creation runs a non-atomic DRAFT→SPOTIFY sequence in
`src/lib/extension/create-playlist-from-draft.ts`:

1. extension reachability + Spotify connection
2. resolve Spotify userId
3. create playlist on Spotify **+ acknowledge (write DB row)**
4. persist match config server-side + resolve ordered track URIs
5. bulk `addToPlaylist`
6. record `match_decision` "added" rows (fire-and-forget)

Because only the client extension can talk to Spotify, steps 3→6 are a non-atomic
dual write. The orchestrator already models two distinct post-create failures:

- **`created-unsynced`** — step 3's Spotify create succeeded but the DB acknowledge
  row never landed (even after `acknowledgeCreateWithRetry`). Handled today:
  `UnsyncedState` offers a **safe Retry** via `resumePlaylistCreateFromDraft`, which
  re-drives the (idempotent) acknowledge and then `finalizePlaylistCreate` against
  the **existing** playlist. It never calls `createPlaylist`, so it can't duplicate.
- **`partial`** — the DB row exists, but `finalizePlaylistCreate` failed at either:
  - **(a) config persist** (`persistNewPlaylistConfig` threw) → nothing added, or
  - **(b) track add** (`addToPlaylist` returned non-success) → nothing added.

  Handled today: `PartialState` — a dead-end. "Open in Spotify" + "Done", no retry.

The recently-shipped honesty fix (companion change to this proposal) made
`PartialState`'s copy truthful — it no longer implies partial track success, because
in both sub-cases **zero tracks reach the playlist** (the add is a single atomic
command; a config failure happens before any add). It also added `console.error`
logging at both `partial` return sites so we can measure branch frequency.

## 2. Problem

`partial` is a genuine dead-end. The only recovery is manual (open in Spotify, add
songs by hand) or throwaway (start a new draft, which would create a *second*
playlist). The infrastructure for a safe resume already exists for the unsynced
case; `partial` is the one post-create state that doesn't reuse it.

## 3. Why we can't just reuse the unsynced retry verbatim

The unsynced retry is safe because every step it re-drives is **idempotent**:
`acknowledgeCreateWithRetry` is a DB upsert keyed by playlist, and
`persistNewPlaylistConfig` is an `UPDATE` on a single row (`updatePlaylistMatchConfig`)
plus a deterministic URI re-derivation. Re-running them changes nothing on a second
pass.

`addToPlaylist` is **not idempotent.** Spotify's add-items endpoint appends; adding
the same URIs twice yields duplicate tracks. For sub-case (a) this is fine — the
first attempt never reached the add, so a resumed add is the first real add. The
risk is sub-case (b) plus one specific failure mode:

- The first `addToPlaylist` **actually succeeded on Spotify**, but the response was
  lost (network drop, extension teardown) so the orchestrator saw a non-success
  outcome and returned `partial`. A naive resume re-adds every URI → **duplicate
  tracks** in the user's playlist.

So a `partial` retry needs an at-least-once → effectively-once story that the
unsynced retry never had to solve.

## 4. Design

### 4.1 Distinguish the two sub-cases

Add a discriminator to the `partial` result so the resume path knows where it
stopped and so telemetry can separate the branches:

```ts
| {
    status: "partial";
    failedStep: "config" | "tracks";
    playlistUri: string;
    spotifyId: string;
    failedTrackCount: number;
  }
```

`CreatePlaylistScreen`'s `FlowResult` must then **retain `playlistUri`** for the
partial case (today it keeps only `spotifyId` + `failedTrackCount`). The submitted
draft is already snapshotted in `submittedInputRef`, so no new draft plumbing is
needed — this mirrors what `handleRetryUnsynced` already does.

### 4.2 Resume entry point

Two viable shapes:

- **Reuse `resumePlaylistCreateFromDraft`.** It re-runs the idempotent acknowledge
  (a no-op when the row already exists) then `finalizePlaylistCreate`. Simplest —
  one code path for both unsynced and partial retries.
- **Add `resumePlaylistFinalizeFromDraft`** that skips acknowledge and calls
  `finalizePlaylistCreate` directly. Marginally leaner; avoids a redundant upsert.

Recommendation: **reuse `resumePlaylistCreateFromDraft`.** The extra acknowledge is
one idempotent server round-trip and keeps a single resume path to reason about and
test.

### 4.3 The duplicate-tracks guard (the crux)

Before re-running the add in a `partial` retry, reconcile against what's already on
the playlist. Options, cheapest first:

- **A. Accept the risk, no guard.** Duplicate tracks are far less bad than a
  duplicate *playlist*, and the lost-response window is narrow. Ship the retry and
  rely on the copy ("this won't create a duplicate playlist") without promising
  no duplicate tracks. Lowest cost; small residual UX wart.
- **B. Track-count gate via `fetchPlaylistMetadata`.** It already returns
  `trackCount`. On retry, if `trackCount > 0` the previous add likely landed — skip
  the add and go straight to success (+ `match_decision` recording). Cheap, no new
  extension command. Coarse: can't tell a lost-response full success from a genuine
  zero, and can't handle a true mid-batch partial (which the current atomic add
  shouldn't produce anyway).
- **C. Diff actual track URIs.** Fetch the playlist's current items, add only the
  missing URIs. Precise and fully idempotent, but needs a "read playlist items"
  extension command that doesn't exist today — the biggest lift.

Recommendation: **B for the first version.** It closes the common duplicate window
with existing tooling. Escalate to C only if telemetry shows real duplicate reports.

### 4.4 UI

Give `PartialState` the same treatment `UnsyncedState` already has: a primary
**Retry** with `isRetrying`/`aria-busy`, alongside "Open in Spotify" and "Done".
Reuse the `isRetryingUnsynced`/`handleRetryUnsynced` pattern in
`CreatePlaylistScreen` (likely generalize it to a shared `isRetrying` +
`handleResumeCreate`). Preserve the focus-management and `role="status"` semantics
already in both components.

## 5. Scope

In:
- `failedStep` discriminator on the `partial` result + both return sites.
- Retain `playlistUri` in `FlowResult.partial`.
- Resume wiring for `partial` (reuse `resumePlaylistCreateFromDraft`).
- Track-count duplicate guard (option B) inside the resume/finalize path.
- `PartialState` Retry affordance + screen retry state.
- Tests (see §6).

Out:
- New "read playlist items" extension command / option C diffing.
- Any change to the unsynced path (already shipped).
- Retry limits / backoff UI beyond the existing single-press `isRetrying` guard.

## 6. Testing

- `finalizePlaylistCreate`: config-fail → `partial{failedStep:"config"}`;
  add-fail → `partial{failedStep:"tracks"}`.
- Resume from each sub-case reaches `success` when the underlying step recovers.
- Duplicate guard: when `fetchPlaylistMetadata.trackCount > 0` on a `tracks` retry,
  the add is **skipped** and the result is `success` (no second `addToPlaylist`).
- `PartialState`: Retry present, `aria-busy` while retrying, calls the handler;
  "Open in Spotify"/"Done" still present. Extend the existing `UnsyncedState` test
  block as the template.
- Screen: partial `FlowResult` carries `playlistUri`; retry resumes against it and
  never calls `createPlaylistFromDraft` (no duplicate playlist).

## 7. Ship gate

This state is **rare** (needs step-3 success followed by a step-4/5 failure
mid-flight) and **already recoverable manually**. Before building, read the
`[createPlaylistFromDraft] partial:` logs added in the companion change:

- If `partial` effectively never fires in production → don't build; the honest copy
  is enough.
- If it fires with meaningful frequency → build §4 with guard option B.
- If duplicate-track reports appear after B ships → escalate to option C.

## 8. Note on format

Written as a design doc under `docs/playlist-creation/` to match the existing
`conceptualization.md` / `implementation-plan.md`. If this graduates to scheduled
work it should become an OpenSpec change under `openspec/changes/` (proposal +
tasks + spec delta) so it runs through `openspec validate`, consistent with how
`add-playlist-write-acknowledgement` was handled.
