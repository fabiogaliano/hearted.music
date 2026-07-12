/**
 * Client-facing taste-profile query for the seed stage.
 *
 * Server fn + query options factory so the route loader can ensureQueryData and
 * the seed stage can read it synchronously via useQuery. This is the ONE place
 * the raw-count domain payload is mapped to the presentation VM: window ids gain
 * human labels and a stable recency order, decades gain a "2010s"-style label.
 * Kept out of the domain layer because labels/order are presentation concerns.
 */

import { queryOptions } from "@tanstack/react-query";
import type {
	TasteLikedWindow,
	TasteProfile,
} from "@/lib/domains/library/liked-songs/taste-profile-queries";
import { utcDateString } from "@/lib/domains/taste/match-filters/dates";
import type { LikedAtFilterV1 } from "@/lib/domains/taste/match-filters/types";
import { getTasteProfile } from "@/lib/server/playlists.functions";
import type { TasteProfileVM } from "./seedTypes";

// Human labels for the RPC's window ids. Ids not listed here are dropped — the
// map is the allow-list, so a new SQL bucket can't leak an unlabelled window.
const WINDOW_LABELS: Record<string, string> = {
	"last-30d": "last 30 days",
	"last-3m": "last 3 months",
	"last-6m": "last 6 months",
	"first-3m": "first 3 months",
};

// Recency order the windows read in, independent of the RPC's row order.
const WINDOW_ORDER = ["last-30d", "last-3m", "last-6m", "first-3m"];

/**
 * Turn a window's absolute liked-at bounds into the filter the seed commits.
 * An open-ended (`to === null`) rolling window ("last N days") is an `after`
 * predicate; a bounded one ("first 3 months") is a closed `range`. Bounds are
 * timestamps from the RPC; the filter is day-granular, so we floor to the UTC
 * date — matching how the liked-at predicate compares against midnight.
 */
function windowToLikedAt(window: TasteLikedWindow): LikedAtFilterV1 {
	const startDate = utcDateString(Date.parse(window.from));
	if (window.to === null) return { kind: "after", startDate };
	return {
		kind: "range",
		startDate,
		end: { kind: "date", date: utcDateString(Date.parse(window.to)) },
	};
}

/** Map the raw-count domain profile to the labelled presentation VM. */
export function toTasteProfileVM(profile: TasteProfile): TasteProfileVM {
	const likedWindows = profile.likedWindows
		.filter((w) => w.id in WINDOW_LABELS)
		.sort((a, b) => WINDOW_ORDER.indexOf(a.id) - WINDOW_ORDER.indexOf(b.id))
		.map((w) => ({
			id: w.id,
			label: WINDOW_LABELS[w.id],
			count: w.count,
			likedAt: windowToLikedAt(w),
		}));

	return {
		totalLikedCount: profile.totalLikedCount,
		likedWindows,
		topGenres: profile.topGenres,
		topArtists: profile.topArtists,
		decades: profile.decades.map((d) => ({
			label: `${d.decadeStart}s`,
			from: d.from,
			to: d.to,
			count: d.count,
		})),
	};
}

const TASTE_PROFILE_KEY = ["playlist-taste-profile"] as const;

export function tasteProfileQueryOptions() {
	return queryOptions({
		queryKey: TASTE_PROFILE_KEY,
		queryFn: async () => toTasteProfileVM(await getTasteProfile()),
		// Taste shifts slowly (new likes trickle in); 5 minutes keeps the seed
		// stage fresh enough without refetching on every visit.
		staleTime: 5 * 60_000,
	});
}
