/**
 * Parser for the scored YouTube candidate snapshots the worker persists on a
 * backfill job (low-confidence / no-match) and on a source review (accepted).
 *
 * The authoritative shape is `MatchCandidateSnapshotSchema` in the shared
 * youtube-audio types module. This module re-exports the type alias
 * `AudioFeatureCandidate` (consumed by other control-panel server files) and
 * provides `asCandidates`, which validates each item through the schema so any
 * schema drift between the writer and the DB surfaces as a logged seam error
 * instead of silently coerced nulls.
 *
 * JSONB columns arrive already parsed from postgres.js (built-in JSON OIDs are
 * decoded even with fetch_types:false — only text[]/numeric[] come back as raw
 * literals). We still handle the raw-string fallback for defensiveness.
 */

import { z } from "zod";
import {
	MatchCandidateSnapshotSchema,
	type MatchCandidateSnapshot,
} from "@/lib/integrations/youtube-audio/types";

/** Alias consumed by other control-panel server files. */
export type AudioFeatureCandidate = MatchCandidateSnapshot;

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

	const out: AudioFeatureCandidate[] = [];
	for (let i = 0; i < arr.length; i++) {
		const result = MatchCandidateSnapshotSchema.safeParse(arr[i]);
		if (result.success) {
			out.push(result.data);
		} else {
			// Log loudly so schema drift between the writer and the stored JSONB
			// surfaces in server logs rather than silently disappearing from the UI.
			// Skip the bad item so the rest of the list still renders.
			console.error(
				`[audio-candidates] candidate ${i} failed schema parse; skipping.`,
				z.flattenError(result.error),
				"raw:", JSON.stringify(arr[i]),
			);
		}
	}
	return out;
}
