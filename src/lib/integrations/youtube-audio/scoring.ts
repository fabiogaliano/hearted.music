/**
 * Score YouTube candidates against the DB song and decide whether one is a
 * trustworthy enough match to auto-insert a live audio-feature row.
 *
 * Pure and deterministic: no IO, no config beyond the thresholds passed in, so
 * the whole acceptance policy is unit-testable. The bar is deliberately high
 * (clear minScore AND beat the runner-up) because a wrong pick silently poisons
 * matching until an operator catches it in review.
 */

import type {
	CandidateDecision,
	ScoredCandidate,
	SongForScoring,
	YoutubeCandidate,
} from "./types";

export interface ScoringThresholds {
	minScore: number;
	minScoreGap: number;
}

// Wrong-version markers. Single words are matched on token boundaries (so
// "discover" never trips "cover"); multi-word entries match as bounded phrases.
const REJECT_PHRASES = [
	"live",
	"remix",
	"cover",
	"karaoke",
	"sped up",
	"slowed",
	"nightcore",
	"8d audio",
	"8d",
	"reaction",
	"tutorial",
] as const;

const OFFICIAL_MARKERS = [
	"official audio",
	"official video",
	"provided to youtube by",
] as const;

export function normalizeText(input: string): string {
	return input
		.toLowerCase()
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/&/g, " and ")
		.replace(/[^a-z0-9]+/g, " ")
		.trim()
		.replace(/\s+/g, " ");
}

/** Drop (...) and [...] suffixes — used for token matching, not penalty scan. */
export function stripBracketed(input: string): string {
	return input.replace(/[([][^)\]]*[)\]]/g, " ");
}

export function tokenize(input: string): string[] {
	const norm = normalizeText(input);
	return norm.length === 0 ? [] : norm.split(" ");
}

/** Space-padded substring match so `phrase` is bounded by word edges. */
function containsPhrase(haystackNorm: string, phrase: string): boolean {
	return ` ${haystackNorm} `.includes(` ${normalizeText(phrase)} `);
}

function fractionPresent(
	needleTokens: string[],
	haystack: Set<string>,
): number {
	if (needleTokens.length === 0) return 0;
	let hits = 0;
	for (const t of needleTokens) if (haystack.has(t)) hits++;
	return hits / needleTokens.length;
}

export function scoreCandidate(
	song: SongForScoring,
	candidate: YoutubeCandidate,
): ScoredCandidate {
	const titleFullNorm = normalizeText(candidate.title);
	const channelNorm = normalizeText(candidate.channel ?? "");
	const songNameNorm = normalizeText(song.name);

	const reasons: string[] = [];

	// --- Hard rejects ------------------------------------------------------
	const penaltyHay = `${titleFullNorm} ${channelNorm}`;
	for (const phrase of REJECT_PHRASES) {
		if (containsPhrase(penaltyHay, phrase)) {
			return {
				candidate,
				score: 0,
				reasons,
				rejected: true,
				rejectReason: `contains "${phrase}"`,
			};
		}
	}
	// Instrumental is only a reject when the *song* isn't itself instrumental.
	if (
		containsPhrase(penaltyHay, "instrumental") &&
		!containsPhrase(songNameNorm, "instrumental")
	) {
		return {
			candidate,
			score: 0,
			reasons,
			rejected: true,
			rejectReason: "instrumental version",
		};
	}

	// --- Positive signals --------------------------------------------------
	const titleTokens = new Set(tokenize(stripBracketed(candidate.title)));
	const combinedForArtist = new Set([
		...tokenize(stripBracketed(candidate.title)),
		...tokenize(candidate.channel ?? ""),
	]);

	const songNameTokens = tokenize(stripBracketed(song.name));
	const titleMatch = fractionPresent(songNameTokens, titleTokens);
	if (titleMatch >= 0.999) reasons.push("title contains full song title");
	else if (titleMatch > 0) reasons.push("title partially matches song title");

	// Best artist match across all credited artists; channel counts too.
	let artistMatch = 0;
	for (const artist of song.artists) {
		artistMatch = Math.max(
			artistMatch,
			fractionPresent(tokenize(artist), combinedForArtist),
		);
	}
	if (artistMatch >= 0.999) reasons.push("artist present in title/channel");

	const channelTokens = channelNorm.split(" ");
	const isTopic =
		channelTokens.includes("topic") &&
		song.artists.some(
			(a) => fractionPresent(tokenize(a), new Set(channelTokens)) >= 0.999,
		);
	if (isTopic) reasons.push("artist topic channel");

	const officialMarker = OFFICIAL_MARKERS.some((m) =>
		containsPhrase(titleFullNorm, m),
	);
	if (officialMarker) reasons.push("official upload marker");

	const songDurSec = song.durationMs != null ? song.durationMs / 1000 : null;
	const durDiff =
		songDurSec != null && candidate.durationSeconds != null
			? Math.abs(songDurSec - candidate.durationSeconds)
			: null;

	let durationBonus = 0;
	if (durDiff != null) {
		if (durDiff <= 5) {
			durationBonus = 0.15;
			reasons.push("duration within 5s");
		} else if (durDiff <= 12) {
			durationBonus = 0.1;
			reasons.push("duration within 12s");
		} else if (durDiff <= 25) {
			durationBonus = 0.04;
			reasons.push("duration within 25s");
		}
	}

	const officialBonus = officialMarker || isTopic ? 0.1 : 0;
	const raw =
		0.4 * titleMatch + 0.35 * artistMatch + durationBonus + officialBonus;
	const score = Math.min(1, Math.max(0, raw));

	// A duration that's off by more than 25s is almost always a different edit
	// (extended/sped/medley); only an otherwise-perfect official match survives.
	const extremelyStrong =
		titleMatch >= 0.999 && artistMatch >= 0.999 && (officialMarker || isTopic);
	if (durDiff != null && durDiff > 25 && !extremelyStrong) {
		return {
			candidate,
			score,
			reasons,
			rejected: true,
			rejectReason: `duration off by ${Math.round(durDiff)}s`,
		};
	}

	return { candidate, score, reasons, rejected: false };
}

export function scoreCandidates(
	song: SongForScoring,
	candidates: YoutubeCandidate[],
	thresholds: ScoringThresholds,
): CandidateDecision {
	const scored = candidates.map((c) => scoreCandidate(song, c));
	const viable = scored
		.filter((s) => !s.rejected)
		.sort((a, b) => b.score - a.score);

	const best = viable[0];
	const second = viable[1];

	if (!best || best.score < thresholds.minScore) {
		return {
			kind: "manual_needed",
			scored,
			reason: best
				? `best score ${best.score.toFixed(2)} below ${thresholds.minScore}`
				: "no viable candidates",
		};
	}

	if (second && best.score - second.score < thresholds.minScoreGap) {
		return {
			kind: "manual_needed",
			scored,
			reason: `top two within ${thresholds.minScoreGap} (${best.score.toFixed(
				2,
			)} vs ${second.score.toFixed(2)})`,
		};
	}

	return {
		kind: "selected",
		candidate: best.candidate,
		score: best.score,
		reasons: best.reasons,
		scored,
	};
}
