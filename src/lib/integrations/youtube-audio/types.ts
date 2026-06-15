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
