/**
 * Lyric-language detection — a Phase-1 (lightweight) enrichment step that fills
 * song.language from stored lyrics with eld (pure-JS, offline).
 *
 * It runs after song_analysis, because that's the stage that fetches & stores
 * lyrics — so a song's freshly-stored lyrics are detectable in the same chunk.
 * Songs without lyrics yet are simply not returned by the selector and get
 * picked up on a later pass once their lyrics land.
 *
 * Best-effort by contract: it catches its own failures and returns stats instead
 * of throwing, so a detection hiccup never fails the enrichment chunk. language
 * is app metadata, not a matching gate.
 */
import { Result } from "better-result";
import { log } from "@/lib/observability/logger";
import { detectLanguage } from "./detector";
import {
	applyLanguageResolution,
	getSongsNeedingLanguageDetection,
	type LanguageResolution,
} from "./queries";

export interface LanguageDetectionStats {
	candidates: number;
	detected: number;
	bilingual: number;
	songsWritten: number;
}

const EMPTY: LanguageDetectionStats = {
	candidates: 0,
	detected: 0,
	bilingual: 0,
	songsWritten: 0,
};

/**
 * Detects language for the not-yet-checked, lyric-bearing songs among the given
 * ids, then writes the results. Safe to call on every batch: checked songs are
 * filtered out in SQL, so steady state is a no-op.
 */
export async function detectLanguageForSongs(
	songIds: string[],
): Promise<LanguageDetectionStats> {
	try {
		if (songIds.length === 0) return EMPTY;

		const candidatesResult = await getSongsNeedingLanguageDetection(songIds);
		if (Result.isError(candidatesResult)) {
			log.warn("language-detection:select-failed", {
				error: candidatesResult.error.message,
			});
			return EMPTY;
		}
		const candidates = candidatesResult.value;
		if (candidates.length === 0) return EMPTY;

		const payload: LanguageResolution[] = [];
		let detected = 0;
		let bilingual = 0;
		for (const { songId, lyricsText } of candidates) {
			const result = await detectLanguage(lyricsText);
			if (result.language) detected++;
			if (result.secondary) bilingual++;
			payload.push({
				song_id: songId,
				language: result.language,
				language_confidence: result.language ? result.confidence : null,
				language_secondary: result.secondary,
			});
		}

		const applied = await applyLanguageResolution(payload);
		if (Result.isError(applied)) {
			log.warn("language-detection:apply-failed", {
				error: applied.error.message,
			});
			return EMPTY;
		}

		const stats: LanguageDetectionStats = {
			candidates: candidates.length,
			detected,
			bilingual,
			songsWritten: applied.value,
		};
		log.info("language-detection:resolved", { ...stats });
		return stats;
	} catch (err) {
		log.warn("language-detection:unexpected-error", {
			error: err instanceof Error ? err.message : String(err),
		});
		return EMPTY;
	}
}
