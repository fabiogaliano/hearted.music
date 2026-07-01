/**
 * Shared types for the yt-dlp audio acquisition path: YouTube candidates, the
 * scoring decision, ffprobe results, and extracted clips.
 */

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
 * A flattened, persistence-ready snapshot of one scored candidate. This is the
 * exact JSON we store on the job (low-confidence) and the review (accepted) so
 * the operator can see WHICH links the search found and why each scored what it
 * did — and so the accepted-vs-candidate set can later be exported as labeled
 * data for tuning the reject phrases / weights / thresholds. `rank` is the
 * 1-based position among viable (non-rejected) candidates by score; rejected
 * candidates carry `null`.
 */
export interface MatchCandidateSnapshot {
	videoId: string;
	url: string;
	title: string;
	channel: string | null;
	durationSeconds: number | null;
	thumbnailUrl: string | null;
	score: number;
	reasons: string[];
	rejected: boolean;
	rejectReason: string | null;
	rank: number | null;
}

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
