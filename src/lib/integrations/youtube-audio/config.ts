/**
 * Tuning constants for the yt-dlp audio-feature backfill path.
 *
 * These are calibration knobs, not per-deployment secrets, so they live as a
 * single plain object like src/lib/domains/taste/song-matching/config.ts. No env
 * vars and no feature flag: the backfill is always on.
 */
export const audioFeatureBackfillConfig = {
	// One job at a time per worker process. ReccoBeats file analysis is
	// rate-limited; horizontal replicas additionally share a DB-backed provider
	// lease so the global cap holds. Bump only after observing headroom.
	concurrency: 1,
	tmpDir: "/tmp/hearted-audio-feature-backfill",
	// Hard ceiling on the downloaded source so a worker can't be pinned by a
	// multi-hour upload masquerading as a track.
	maxDownloadMb: 80,
	searchResults: 8,
	// The top candidate must clear minScore to be auto-selected. We deliberately
	// don't also require beating the runner-up by a gap: near-identical uploads of
	// the same recording tie constantly, and for feature extraction either is fine
	// (wrong *versions* are already filtered out by the scorer's reject phrases).
	minScore: 0.82,
	requestTimeoutMs: 120_000,
	// ReccoBeats truncates anything past 30s, so clips are capped there and we
	// take up to three of them to cover a full track.
	clipCount: 3,
	clipSeconds: 30,
	clipBitrateKbps: 128,
	// How far normalized clip tempos may disagree before tempoConfidence drops to
	// "low" in the aggregation metadata.
	tempoHalfDoubleTolerance: 0.08,
} as const;

export type AudioFeatureBackfillConfig = typeof audioFeatureBackfillConfig;
