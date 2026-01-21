/**
 * Analysis pipeline error types.
 */

import { TaggedError } from "better-result";

/** LLM analysis failed for a song or playlist */
export class AnalysisFailedError extends TaggedError("AnalysisFailedError")<{
	songId?: string;
	playlistId?: string;
	reason: string;
	message: string;
}>() {
	constructor(opts: { songId?: string; playlistId?: string; reason: string }) {
		const target = opts.songId
			? `song ${opts.songId}`
			: opts.playlistId
				? `playlist ${opts.playlistId}`
				: "unknown";
		super({
			...opts,
			message: `Analysis failed for ${target}: ${opts.reason}`,
		});
	}
}

/** No lyrics available for song (pipeline-level abstraction) */
export class NoLyricsAvailableError extends TaggedError(
	"NoLyricsAvailableError",
)<{
	songId: string;
	artist: string;
	title: string;
	message: string;
}>() {
	constructor(songId: string, artist: string, title: string) {
		super({
			songId,
			artist,
			title,
			message: `No lyrics found for "${artist} - ${title}"`,
		});
	}
}

/** Pipeline configuration error (missing API keys, invalid config) */
export class PipelineConfigError extends TaggedError("PipelineConfigError")<{
	provider?: string;
	reason: string;
	message: string;
}>() {
	constructor(reason: string, provider?: string) {
		super({
			provider,
			reason,
			message: provider
				? `Pipeline config error for ${provider}: ${reason}`
				: `Pipeline config error: ${reason}`,
		});
	}
}

/** All analysis pipeline errors */
export type AnalysisError =
	| AnalysisFailedError
	| NoLyricsAvailableError
	| PipelineConfigError;
