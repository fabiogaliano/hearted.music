/**
 * Score YouTube candidates against the DB song and decide whether one is a
 * trustworthy enough match to auto-insert a live audio-feature row.
 *
 * Pure and deterministic: no IO, no config beyond the thresholds passed in, so
 * the whole acceptance policy is unit-testable. Acceptance is a clear minScore on
 * the best viable candidate. We deliberately do NOT also require beating the
 * runner-up: the reject phrases (live/remix/cover/…) already filter wrong
 * versions, so the remaining candidates are near-identical uploads of the same
 * recording that tie constantly — and for feature extraction either is fine.
 *
 * Before title matching we strip "same-recording" qualifiers the DB name carries
 * but YouTube uploads omit ("- Remastered", "- 2011 Remaster", "- Single
 * Version"): a remaster is the same performance, so leaving those tokens in would
 * unfairly penalize a correct match's title score.
 */

import type {
	CandidateDecision,
	ScoredCandidate,
	SongForScoring,
	YoutubeCandidate,
} from "./types";

export interface ScoringThresholds {
	minScore: number;
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
	"instrumental",
] as const;

const OFFICIAL_MARKERS = [
	"official audio",
	"official video",
	"provided to youtube by",
] as const;

export function normalizeText(input: string): string {
	// NFKD (compatibility decomposition), not NFD: it folds look-alike glyphs
	// like math-bold "𝙨𝙡𝙤𝙬𝙚𝙙" and full-width text down to plain ASCII. Uploaders
	// use those styled letters to dodge the reject phrases ("slowed", "sped up");
	// without this the [^a-z0-9] strip would just delete them and the marker would
	// vanish instead of matching. Diacritic-strip below still works (NFKD also
	// emits combining marks for accents).
	return input
		.toLowerCase()
		.normalize("NFKD")
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

// A trailing " - <qualifier>" that denotes the SAME recording (a remaster /
// single / radio edit is the same performance), which YouTube uploads routinely
// drop. Live/remix/cover are intentionally absent — those are different
// recordings and stay handled by REJECT_PHRASES. The inner [^-–—]* keeps the
// match inside the last dash-delimited segment so real titles aren't truncated.
const SAME_RECORDING_QUALIFIER =
	/\s[-–—]\s[^-–—]*\b(?:remaster(?:ed)?|single version|album version|radio edit|mono|stereo|bonus track|anniversary (?:edition|remaster)|digital remaster|re-?recorded)\b[^-–—]*$/i;

/** Strip a trailing "- Remastered / - 2011 Remaster / - Single Version" tag. */
export function stripVersionQualifier(input: string): string {
	return input.replace(SAME_RECORDING_QUALIFIER, "").trim();
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
	// Reject wrong-version markers (live/remix/cover/instrumental/…) — but only
	// when the *song itself* doesn't carry that marker. A track literally named
	// "… (Doveman Remix)" or "… - Live" should match a YouTube upload that says
	// "remix"/"live"; the marker is only "wrong" when it's absent from the Spotify
	// name, i.e. the upload is a different version than the one we actually want.
	const penaltyHay = `${titleFullNorm} ${channelNorm}`;
	for (const phrase of REJECT_PHRASES) {
		if (
			containsPhrase(penaltyHay, phrase) &&
			!containsPhrase(songNameNorm, phrase)
		) {
			return {
				candidate,
				score: 0,
				reasons,
				rejected: true,
				rejectReason: `contains "${phrase}"`,
			};
		}
	}

	// --- Positive signals --------------------------------------------------
	const titleTokens = new Set(tokenize(stripBracketed(candidate.title)));
	const combinedForArtist = new Set([
		...tokenize(stripBracketed(candidate.title)),
		...tokenize(candidate.channel ?? ""),
	]);

	const songNameTokens = tokenize(
		stripBracketed(stripVersionQualifier(song.name)),
	);
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

	if (!best || best.score < thresholds.minScore) {
		return {
			kind: "manual_needed",
			scored,
			reason: best
				? `best score ${best.score.toFixed(2)} below ${thresholds.minScore}`
				: "no viable candidates",
		};
	}

	// No runner-up gap check: equally-good uploads of the same recording tie all
	// the time, and either is fine for feature extraction. `viable` is sorted by
	// score and Array.sort is stable, so ties resolve to YouTube's own search rank.
	return {
		kind: "selected",
		candidate: best.candidate,
		score: best.score,
		reasons: best.reasons,
		scored,
	};
}
