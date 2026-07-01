/**
 * Shared shape + parser for the scored YouTube candidate snapshots the worker
 * persists on a backfill job (low-confidence / no-match) and on a source review
 * (accepted). Mirrors the worker's MatchCandidateSnapshot but is defined locally
 * so the control-panel server stays self-contained (see README "Architecture").
 *
 * JSONB columns arrive already parsed from postgres.js (built-in JSON OIDs are
 * decoded even with fetch_types:false — only text[]/numeric[] come back as raw
 * literals), but we still normalize defensively: nulls, a missing field, or a
 * stray JSON string can't be allowed to crash the queue render.
 */
export interface AudioFeatureCandidate {
	videoId: string | null;
	url: string | null;
	title: string | null;
	channel: string | null;
	durationSeconds: number | null;
	thumbnailUrl: string | null;
	score: number | null;
	reasons: string[];
	rejected: boolean;
	rejectReason: string | null;
	rank: number | null;
}

const str = (v: unknown): string | null => (v == null ? null : String(v));
const num = (v: unknown): number | null => (v == null ? null : Number(v));

function mapCandidate(raw: unknown): AudioFeatureCandidate | null {
	if (!raw || typeof raw !== "object") return null;
	const c = raw as Record<string, unknown>;
	return {
		videoId: str(c.videoId),
		url: str(c.url),
		title: str(c.title),
		channel: str(c.channel),
		durationSeconds: num(c.durationSeconds),
		thumbnailUrl: str(c.thumbnailUrl),
		score: num(c.score),
		reasons: Array.isArray(c.reasons) ? c.reasons.map(String) : [],
		rejected: c.rejected === true,
		rejectReason: str(c.rejectReason),
		rank: num(c.rank),
	};
}

export function asCandidates(v: unknown): AudioFeatureCandidate[] {
	let arr: unknown = v;
	if (typeof v === "string") {
		try {
			arr = JSON.parse(v);
		} catch {
			return [];
		}
	}
	if (!Array.isArray(arr)) return [];
	return arr
		.map(mapCandidate)
		.filter((c): c is AudioFeatureCandidate => c !== null);
}
