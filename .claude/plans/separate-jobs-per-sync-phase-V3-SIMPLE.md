# Plan: Separate Jobs Per Sync Phase (V3 - Simplified)

## Goal

Refactor `fullSync` to use 3 separate jobs (one per phase). Simplified from V2.

## What Changed from V2

| Removed | Reason |
|---------|--------|
| `usePhaseJobsProgress` hook | Inline 3x `useJobProgress` in SyncingStep |
| `phases.ts` file | Inline types, hardcode labels in UI |
| `SyncPhaseSchema` | Plain TypeScript type is sufficient |
| `PhaseWeightSchema` | Use simple 33/33/33 progress |
| `fullSyncWithNewJobs` | YAGNI - no cron/CLI caller exists |
| `safeParse` navigation state | DB step is source of truth |

| Kept | Reason |
|------|--------|
| 3 separate jobs | Core feature |
| `PhaseJobIdsSchema` | Server function input validation |
| `runPhase` helper | Reduces duplication in orchestrator |

---

## Implementation Steps

### Step 1: Add PhaseJobIds Type and Schema

**File**: `src/lib/jobs/progress/types.ts` (ADD to existing file)

```typescript
import { z } from "zod";

/**
 * Job IDs for each sync phase.
 */
export const PhaseJobIdsSchema = z.object({
  liked_songs: z.string().uuid(),
  playlists: z.string().uuid(),
  playlist_tracks: z.string().uuid(),
});

export type PhaseJobIds = z.infer<typeof PhaseJobIdsSchema>;
```

---

### Step 2: Update createSyncJob (Creates 3 Jobs)

**File**: `src/lib/server/onboarding.server.ts`

```typescript
import { Result } from "better-result";
import type { PhaseJobIds } from "@/lib/jobs/progress/types";

export const createSyncJob = createServerFn({ method: "POST" }).handler(
  async (): Promise<PhaseJobIds> => {
    const request = getRequest();
    const session = requireSession(request);

    const [songsResult, playlistsResult, tracksResult] = await Promise.all([
      createJob(session.accountId, "sync_liked_songs"),
      createJob(session.accountId, "sync_playlists"),
      createJob(session.accountId, "sync_playlist_tracks"),
    ]);

    if (Result.isError(songsResult)) {
      throw new OnboardingError("create_sync_jobs", songsResult.error);
    }
    if (Result.isError(playlistsResult)) {
      throw new OnboardingError("create_sync_jobs", playlistsResult.error);
    }
    if (Result.isError(tracksResult)) {
      throw new OnboardingError("create_sync_jobs", tracksResult.error);
    }

    return {
      liked_songs: songsResult.value.id,
      playlists: playlistsResult.value.id,
      playlist_tracks: tracksResult.value.id,
    };
  },
);
```

---

### Step 3: Update startSync (Accepts PhaseJobIds)

**File**: `src/lib/server/onboarding.server.ts`

```typescript
import { PhaseJobIdsSchema } from "@/lib/jobs/progress/types";

const startSyncInputSchema = z.object({
  phaseJobIds: PhaseJobIdsSchema,
});

export const startSync = createServerFn({ method: "POST" })
  .inputValidator(startSyncInputSchema)
  .handler(async ({ data }): Promise<{ success: true }> => {
    const request = getRequest();
    const session = requireSession(request);

    // Validate job ownership
    for (const [phase, jobId] of Object.entries(data.phaseJobIds)) {
      const jobResult = await getJobById(jobId);
      if (Result.isError(jobResult)) {
        throw new OnboardingError("start_sync", new Error(`Failed to get ${phase} job`));
      }
      const job = jobResult.value;
      if (!job || job.account_id !== session.accountId) {
        throw new OnboardingError("start_sync", new Error(`${phase} job not found`));
      }
    }

    const spotifyResult = await getSpotifyService(session.accountId);
    if (Result.isError(spotifyResult)) {
      throw new OnboardingError("start_sync", new Error("Spotify not connected"));
    }

    const orchestrator = new SyncOrchestrator(spotifyResult.value);
    const syncResult = await orchestrator.fullSync(
      session.accountId,
      data.phaseJobIds,
    );

    if (Result.isError(syncResult)) {
      throw new OnboardingError("start_sync", syncResult.error);
    }

    return { success: true };
  });
```

---

### Step 4: Update fullSync in Orchestrator

**File**: `src/lib/capabilities/sync/orchestrator.ts`

```typescript
import type { PhaseJobIds } from "@/lib/jobs/progress/types";

export class SyncOrchestrator {
  /**
   * Syncs all three phases sequentially with separate job tracking.
   */
  async fullSync(
    accountId: string,
    phaseJobIds: PhaseJobIds,
    options?: { onProgress?: SyncProgressCallback },
  ): Promise<Result<FullSyncResult, SyncOrchestratorError>> {
    try {
      // Phase 1: Liked Songs
      const phase1Result = await this.runPhase(
        phaseJobIds.liked_songs,
        () => this.syncLikedSongs(accountId, { onProgress: options?.onProgress }),
      );
      if (Result.isError(phase1Result)) return phase1Result;

      // Phase 2: Playlists
      const phase2Result = await this.runPhase(
        phaseJobIds.playlists,
        () => this.syncPlaylists(accountId, { onProgress: options?.onProgress }),
      );
      if (Result.isError(phase2Result)) return phase2Result;

      // Phase 3: Playlist Tracks
      const phase3Result = await this.runPhase(
        phaseJobIds.playlist_tracks,
        () => this.syncPlaylistTracks(accountId, { onProgress: options?.onProgress }),
      );
      if (Result.isError(phase3Result)) return phase3Result;

      return Result.ok({
        likedSongs: phase1Result.value,
        playlists: phase2Result.value,
        playlistTracks: phase3Result.value,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return Result.err(new SyncFailedError("full_sync", accountId, errorMessage));
    }
  }

  /**
   * Runs a single sync phase with job lifecycle management.
   */
  private async runPhase<T>(
    jobId: string,
    syncFn: () => Promise<Result<T, SyncOrchestratorError>>,
  ): Promise<Result<T, SyncOrchestratorError>> {
    const startResult = await startJob(jobId);
    if (Result.isError(startResult)) {
      return Result.err(startResult.error);
    }

    const result = await syncFn();

    if (Result.isError(result)) {
      emitError(jobId, result.error.message);
      emitStatus(jobId, "failed");
      await failJob(jobId, result.error.message);
      return result;
    }

    emitStatus(jobId, "completed");
    await completeJob(jobId);
    return result;
  }
}
```

---

### Step 5: Update HistoryState Type

**File**: `src/features/onboarding/types.ts`

```typescript
import type { PhaseJobIds } from "@/lib/jobs/progress/types";

export interface SyncStats {
  songs: number;
  playlists: number;
}

declare module "@tanstack/react-router" {
  interface HistoryState {
    jobId?: string;  // Legacy, can remove after migration
    phaseJobIds?: PhaseJobIds;
    theme?: string;
    syncStats?: SyncStats;
  }
}
```

---

### Step 6: Update SyncingStep (Inline 3x useJobProgress)

**File**: `src/features/onboarding/components/SyncingStep.tsx`

```typescript
import { useEffect, useRef, useMemo } from "react";
import type { PhaseJobIds } from "@/lib/jobs/progress/types";
import { useJobProgress } from "@/lib/hooks/useJobProgress";
import { useOnboardingNavigation } from "../hooks/useOnboardingNavigation";
import { startSync } from "@/lib/server/onboarding.server";
import { toast } from "sonner";

interface SyncingStepProps {
  theme: ThemeConfig;
  phaseJobIds: PhaseJobIds | null;
}

export function SyncingStep({ theme, phaseJobIds }: SyncingStepProps) {
  const { goToFlagPlaylists } = useOnboardingNavigation();
  const syncStartedRef = useRef(false);

  // Subscribe to all 3 jobs
  const songs = useJobProgress(phaseJobIds?.liked_songs ?? null);
  const playlists = useJobProgress(phaseJobIds?.playlists ?? null);
  const tracks = useJobProgress(phaseJobIds?.playlist_tracks ?? null);

  // Simple 33/33/33 progress
  const { percent, label, allComplete, isFailed, error } = useMemo(() => {
    const phases = [
      { state: songs, label: "Syncing songs..." },
      { state: playlists, label: "Syncing playlists..." },
      { state: tracks, label: "Syncing tracks..." },
    ];

    const completedCount = phases.filter(p => p.state.status === "completed").length;
    const failed = phases.find(p => p.state.status === "failed");
    const current = phases.find(p =>
      p.state.status === "running" || p.state.status === "pending"
    );

    return {
      percent: Math.round((completedCount / 3) * 100),
      label: failed ? "Sync failed" : current?.label ?? "Complete!",
      allComplete: completedCount === 3,
      isFailed: !!failed,
      error: failed?.state.error ?? null,
    };
  }, [songs.status, playlists.status, tracks.status]);

  // Extract counts for stats
  const phaseCounts = useMemo(() => ({
    songs: songs.items.get("liked_songs")?.count ?? 0,
    playlists: playlists.items.get("playlists")?.count ?? 0,
  }), [songs.items, playlists.items]);

  // Start sync on mount
  useEffect(() => {
    if (!phaseJobIds || syncStartedRef.current) return;
    syncStartedRef.current = true;

    startSync({ data: { phaseJobIds } }).catch((err) => {
      console.error("Failed to start sync:", err);
      toast.error("Failed to start sync. Please try again.");
    });
  }, [phaseJobIds]);

  // Auto-advance on complete
  useEffect(() => {
    if (allComplete) {
      const timer = setTimeout(() => {
        goToFlagPlaylists({ syncStats: phaseCounts });
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [allComplete, phaseCounts, goToFlagPlaylists]);

  // Handle missing phaseJobIds (refresh during sync)
  if (!phaseJobIds) {
    return (
      <StepContainer theme={theme}>
        <h2>Sync interrupted</h2>
        <p>Please start over to sync your library.</p>
        <button onClick={() => window.location.href = "/onboarding?step=welcome"}>
          Start Over
        </button>
      </StepContainer>
    );
  }

  if (isFailed) {
    return (
      <StepContainer theme={theme}>
        <h2>Something went wrong</h2>
        <p>{error}</p>
        <button onClick={() => window.location.href = "/onboarding?step=welcome"}>
          Start Over
        </button>
      </StepContainer>
    );
  }

  return (
    <StepContainer theme={theme}>
      <h2>{label}</h2>
      <ProgressBar percent={percent} />
      {phaseCounts.songs > 0 && <p>{phaseCounts.songs} songs found</p>}
      {phaseCounts.playlists > 0 && <p>{phaseCounts.playlists} playlists found</p>}
    </StepContainer>
  );
}
```

---

### Step 7: Update WelcomeStep

**File**: `src/features/onboarding/components/WelcomeStep.tsx`

```typescript
import { createSyncJob } from "@/lib/server/onboarding.server";
import { useOnboardingNavigation } from "../hooks/useOnboardingNavigation";

export function WelcomeStep({ theme }: { theme: ThemeConfig }) {
  const { goToPickColor } = useOnboardingNavigation();
  const [isCreatingJob, setIsCreatingJob] = useState(false);

  const handleContinue = async () => {
    setIsCreatingJob(true);
    try {
      const phaseJobIds = await createSyncJob();
      await goToPickColor({ phaseJobIds });
    } catch (error) {
      console.error("Failed to create sync jobs:", error);
      toast.error("Failed to start. Please try again.");
    } finally {
      setIsCreatingJob(false);
    }
  };

  return (
    <StepContainer theme={theme}>
      <h1>Welcome to Hearted</h1>
      <button onClick={handleContinue} disabled={isCreatingJob}>
        {isCreatingJob ? "Starting..." : "Get Started"}
      </button>
    </StepContainer>
  );
}
```

---

### Step 8: Update Navigation Hook

**File**: `src/features/onboarding/hooks/useOnboardingNavigation.ts`

```typescript
import type { PhaseJobIds } from "@/lib/jobs/progress/types";

export function useOnboardingNavigation() {
  const navigate = useNavigate();

  const goToPickColor = useCallback(
    async (options?: { phaseJobIds?: PhaseJobIds }) => {
      await saveOnboardingStep({ data: { step: "pick-color" } });
      navigate({
        search: { step: "pick-color" },
        state: (prev) => ({
          ...prev,
          ...(options?.phaseJobIds && { phaseJobIds: options.phaseJobIds }),
        }),
      });
    },
    [navigate],
  );

  const goToSyncing = useCallback(
    async (options?: { phaseJobIds?: PhaseJobIds }) => {
      await saveOnboardingStep({ data: { step: "syncing" } });
      navigate({
        search: { step: "syncing" },
        state: (prev) => ({
          ...prev,
          ...(options?.phaseJobIds && { phaseJobIds: options.phaseJobIds }),
        }),
      });
    },
    [navigate],
  );

  // ... rest unchanged
}
```

---

### Step 9: Update Onboarding.tsx

**File**: `src/features/onboarding/Onboarding.tsx`

```typescript
export function Onboarding() {
  const { data } = useSuspenseQuery(getOnboardingDataOptions());
  const location = useLocation();

  const phaseJobIds = location.state?.phaseJobIds ?? null;
  const syncStats = location.state?.syncStats ?? null;

  const { step, theme } = data.currentStep;

  return (
    <div>
      {step === "welcome" && <WelcomeStep theme={theme} />}
      {step === "pick-color" && <PickColorStep theme={theme} />}
      {step === "connecting" && <ConnectingStep />}
      {step === "syncing" && (
        <SyncingStep theme={theme} phaseJobIds={phaseJobIds} />
      )}
      {step === "flag-playlists" && (
        <FlagPlaylistsStep theme={theme} syncStats={syncStats} />
      )}
      {step === "ready" && <ReadyStep theme={theme} syncStats={syncStats} />}
    </div>
  );
}
```

---

## Files Summary

| File | Change |
|------|--------|
| `src/lib/jobs/progress/types.ts` | **ADD** `PhaseJobIdsSchema` + `PhaseJobIds` type |
| `src/lib/server/onboarding.server.ts` | **UPDATE** `createSyncJob` (3 jobs), `startSync` (new schema) |
| `src/lib/capabilities/sync/orchestrator.ts` | **UPDATE** `fullSync` + add `runPhase` helper |
| `src/features/onboarding/types.ts` | **UPDATE** Add `phaseJobIds` to HistoryState |
| `src/features/onboarding/components/SyncingStep.tsx` | **UPDATE** Inline 3x `useJobProgress` |
| `src/features/onboarding/components/WelcomeStep.tsx` | **UPDATE** Call updated `createSyncJob` |
| `src/features/onboarding/hooks/useOnboardingNavigation.ts` | **UPDATE** Pass `phaseJobIds` |
| `src/features/onboarding/Onboarding.tsx` | **UPDATE** Read `phaseJobIds` from state |

**Total: 8 files** (down from 11 in V2)

---

## Verification Checklist

- [ ] `bunx tsc --noEmit` passes
- [ ] Click "Get Started" → 3 jobs created in DB
- [ ] Progress bar shows 0% → 33% → 66% → 100%
- [ ] Phase labels update: "Syncing songs..." → "playlists..." → "tracks..."
- [ ] Auto-advances to flag-playlists on complete
- [ ] Refresh during sync shows "Sync interrupted" message
- [ ] Phase failure shows error + "Start Over" button

---

## Comparison: V2 vs V3

| Metric | V2 | V3 |
|--------|----|----|
| Files changed | 11 | 8 |
| New files | 2 (`phases.ts`, `usePhaseJobsProgress.ts`) | 0 |
| Zod schemas | 4 | 1 |
| Lines of code | ~400 | ~250 |
| Progress calculation | Weighted (0-40-60-100) | Simple (33/33/33) |
| Abstractions | Hook + constants file | Inline in component |
