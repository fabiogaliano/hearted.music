/**
 * Shared types for the yt-dlp audio acquisition path: YouTube candidates, the
 * scoring decision, ffprobe results, and extracted clips.
 */

import { z } from "zod";

/** A YouTube result, after metadata hydration. */
export interface YoutubeCandidate {
	videoId: string;
	url: string;
	title: string;
	channel: string | null;
	durationSeconds: number | null;
	thumbnailUrl: string | null;
}

/** A candidate after scoring against the DB song. */
export interface ScoredCandidate {
	candidate: YoutubeCandidate;
	score: number;
	reasons: string[];
	rejected: boolean;
	rejectReason?: string;
}

/**
 * Schema for the persisted JSONB candidate snapshot. Nullability is derived
 * directly from the writer (`toCandidateSnapshots` in scoring.ts):
 *   - videoId/url/title come from YoutubeCandidate where all three are `string`
 *     → required non-null.
 *   - channel/durationSeconds/thumbnailUrl are `string|null` / `number|null`
 *     on YoutubeCandidate → nullable.
 *   - score/reasons/rejected come from ScoredCandidate → always present,
 *     non-null.
 *   - rejectReason is `ScoredCandidate.rejectReason ?? null` → nullable.
 *   - rank is `number | null` (null for rejected candidates) → nullable.
 * This schema is the single source of truth for both the write path (jobs.ts)
 * and the read path (control-panel/server/audio-candidates.ts). A rename or
 * missing field in the writer will surface as a parse error at the read seam.
 */
export const MatchCandidateSnapshotSchema = z.object({
	videoId: z.string(),
	url: z.string(),
	title: z.string(),
	channel: z.string().nullable(),
	durationSeconds: z.number().nullable(),
	thumbnailUrl: z.string().nullable(),
	score: z.number(),
	reasons: z.array(z.string()),
	rejected: z.boolean(),
	rejectReason: z.string().nullable(),
	rank: z.number().nullable(),
});

/**
 * A flattened, persistence-ready snapshot of one scored candidate. This is the
 * exact JSON we store on the job (low-confidence) and the review (accepted) so
 * the operator can see WHICH links the search found and why each scored what it
 * did — and so the accepted-vs-candidate set can later be exported as labeled
 * data for tuning the reject phrases / weights / thresholds. `rank` is the
 * 1-based position among viable (non-rejected) candidates by score; rejected
 * candidates carry `null`.
 */
export type MatchCandidateSnapshot = z.infer<
	typeof MatchCandidateSnapshotSchema
>;

/**
 * Result of scoring a candidate set. `selected` means one candidate cleared the
 * confidence bar and beat the runner-up; `manual_needed` means the worker should
 * not auto-insert and the song needs an operator-provided source.
 */
export type CandidateDecision =
	| {
			kind: "selected";
			candidate: YoutubeCandidate;
			score: number;
			reasons: string[];
			scored: ScoredCandidate[];
	  }
	| { kind: "manual_needed"; scored: ScoredCandidate[]; reason: string };

/** The subset of the DB song row that scoring needs. */
export interface SongForScoring {
	name: string;
	artists: string[];
	albumName: string | null;
	durationMs: number | null;
	spotifyId?: string | null;
}

/** ffprobe summary of a downloaded source file. */
export interface ProbeResult {
	durationSeconds: number;
	hasAudioStream: boolean;
	sizeBytes: number;
}

/** A 0–30s mp3 clip extracted from the source for ReccoBeats analysis. */
export interface ClipFile {
	path: string;
	startSeconds: number;
	durationSeconds: number;
}
