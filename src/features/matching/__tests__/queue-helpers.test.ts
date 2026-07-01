import { describe, expect, it } from "vitest";
import type { MatchReviewResult } from "@/lib/server/match-review-queue.functions";
import {
	countAppendedFromTotal,
	deriveCaughtUp,
	deriveEmptyStateReason,
	deriveProgressIndex,
	deriveUnresolvedIds,
	nextItemIdAfterResolved,
	resolveCurrentItemId,
	shouldBootstrapReadyQueue,
	shouldOfferLoosenStrictness,
} from "../queue-helpers";

function makeQueue(
	overrides: Partial<MatchReviewResult> = {},
): MatchReviewResult {
	return {
		sessionId: "session-1",
		items: [],
		total: 0,
		caughtUp: false,
		hiddenReviewItemCount: 0,
		...overrides,
	};
}

function makeItem(
	id: string,
	position: number,
	state: "pending" | "active" | "resolved",
) {
	return {
		id,
		position,
		state,
		subject: { orientation: "song" as const, songId: `song-${id}` },
		sourceSnapshotId: "snap-1",
	};
}

// ---------------------------------------------------------------------------
// deriveUnresolvedIds
// ---------------------------------------------------------------------------

describe("deriveUnresolvedIds", () => {
	it("returns empty array for null queue", () => {
		expect(deriveUnresolvedIds(null)).toEqual([]);
	});

	it("returns empty array when all items are resolved", () => {
		const queue = makeQueue({
			items: [
				makeItem("a", 0, "resolved"),
				makeItem("b", 1, "resolved"),
				makeItem("c", 2, "resolved"),
			],
		});
		expect(deriveUnresolvedIds(queue)).toEqual([]);
	});

	it("returns only pending and active items, sorted by position", () => {
		const queue = makeQueue({
			items: [
				makeItem("a", 2, "pending"),
				makeItem("b", 0, "active"),
				makeItem("c", 1, "resolved"),
				makeItem("d", 3, "pending"),
			],
		});
		// b (pos 0), a (pos 2), d (pos 3); c is excluded
		expect(deriveUnresolvedIds(queue)).toEqual(["b", "a", "d"]);
	});

	it("preserves queue order even when items arrive out-of-order", () => {
		const queue = makeQueue({
			items: [
				makeItem("z", 10, "pending"),
				makeItem("y", 5, "pending"),
				makeItem("x", 1, "pending"),
			],
		});
		expect(deriveUnresolvedIds(queue)).toEqual(["x", "y", "z"]);
	});
});

// ---------------------------------------------------------------------------
// deriveCaughtUp — never derived from null song
// ---------------------------------------------------------------------------

describe("deriveCaughtUp", () => {
	it("returns true when queue is null", () => {
		expect(deriveCaughtUp(null, [])).toBe(true);
	});

	it("uses server caughtUp flag as the authoritative signal", () => {
		const queue = makeQueue({ caughtUp: true });
		expect(deriveCaughtUp(queue, ["item-1"])).toBe(true);
	});

	it("returns true when unresolvedIds is empty even if server caughtUp is false", () => {
		const queue = makeQueue({ caughtUp: false });
		expect(deriveCaughtUp(queue, [])).toBe(true);
	});

	it("returns false when there are unresolved items and caughtUp is false", () => {
		const queue = makeQueue({ caughtUp: false });
		expect(deriveCaughtUp(queue, ["item-1", "item-2"])).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// resolveCurrentItemId — id-based card tracking, stable under refetch
// ---------------------------------------------------------------------------

describe("resolveCurrentItemId", () => {
	it("returns null when the unresolved list is empty", () => {
		expect(resolveCurrentItemId([], null)).toBeNull();
		expect(resolveCurrentItemId([], "A")).toBeNull();
	});

	it("returns the first unresolved id when currentItemId is null (initial mount)", () => {
		expect(resolveCurrentItemId(["A", "B", "C"], null)).toBe("A");
	});

	it("returns the tracked id when it is still present in the unresolved list", () => {
		expect(resolveCurrentItemId(["A", "B", "C", "D", "E"], "D")).toBe("D");
	});

	it("does NOT jump when resolved items drop from the head (refetch scenario)", () => {
		// Start with [A,B,C,D,E], user advanced to D.
		// Refetch: A, B, C are now resolved and drop from the list; F, G are appended.
		const afterRefetch = ["D", "E", "F", "G"];
		const result = resolveCurrentItemId(afterRefetch, "D");
		// Must still be D — not E, F, G, or the first item of the new list.
		expect(result).toBe("D");
	});

	it("preserves the current card when new items are appended at the tail", () => {
		const initial = ["A", "B", "C"];
		// User is on B.
		expect(resolveCurrentItemId(initial, "B")).toBe("B");

		const afterAppend = ["A", "B", "C", "D", "E"];
		// After tail-append the card must still be B.
		expect(resolveCurrentItemId(afterAppend, "B")).toBe("B");
	});

	it("falls back to the first unresolved id when the tracked id is no longer present", () => {
		// If the current item was resolved externally (not by this user action),
		// fall back gracefully rather than crashing or showing nothing.
		const afterExternalResolve = ["C", "D", "E"];
		const result = resolveCurrentItemId(afterExternalResolve, "B");
		expect(result).toBe("C");
	});
});

// ---------------------------------------------------------------------------
// countAppendedFromTotal — passive chip tracks total, not unresolved length
// ---------------------------------------------------------------------------

describe("countAppendedFromTotal", () => {
	it("returns 0 when total is unchanged", () => {
		expect(countAppendedFromTotal(5, 5)).toBe(0);
	});

	it("returns 0 when total shrinks (should not happen; defensive)", () => {
		expect(countAppendedFromTotal(5, 3)).toBe(0);
	});

	it("returns the growth even when unresolved length net-zeros (head-drop + tail-append)", () => {
		// Scenario: 3 items resolved (dropped from head) + 3 new appended → net 0
		// on unresolvedIds.length, but total grew by 3.
		expect(countAppendedFromTotal(5, 8)).toBe(3);
	});

	it("returns growth for a simple tail-append", () => {
		expect(countAppendedFromTotal(0, 1)).toBe(1);
		expect(countAppendedFromTotal(3, 6)).toBe(3);
	});
});

// ---------------------------------------------------------------------------
// nextItemIdAfterResolved — local-resolution advance, never revisits a card
// ---------------------------------------------------------------------------

describe("nextItemIdAfterResolved", () => {
	it("returns the item immediately after the resolved one", () => {
		expect(nextItemIdAfterResolved(["A", "B", "C"], "A")).toBe("B");
		expect(nextItemIdAfterResolved(["A", "B", "C"], "B")).toBe("C");
	});

	it("returns null when the resolved item is the last in the list", () => {
		expect(nextItemIdAfterResolved(["A", "B", "C"], "C")).toBeNull();
	});

	it("returns null for a single-item list (resolving the only card)", () => {
		expect(nextItemIdAfterResolved(["A"], "A")).toBeNull();
	});

	it("returns null for an empty list", () => {
		expect(nextItemIdAfterResolved([], "A")).toBeNull();
	});

	it("returns null when the resolved id is not in the list (stale id degrades gracefully)", () => {
		// resolveCurrentItemId's own fallback re-selects the first unresolved item,
		// so returning null here is the safe handoff rather than a crash.
		expect(nextItemIdAfterResolved(["A", "B", "C"], "Z")).toBeNull();
	});

	it("never returns the resolved id itself, even with earlier unresolved items", () => {
		// User on the middle card resolves it; the next card is the one after, and
		// the resolved id must not be reachable again from the result.
		const result = nextItemIdAfterResolved(["A", "B", "C", "D"], "B");
		expect(result).toBe("C");
		expect(result).not.toBe("B");
	});
});

// ---------------------------------------------------------------------------
// deriveProgressIndex — header counts UP through the session, not down
// ---------------------------------------------------------------------------

describe("deriveProgressIndex", () => {
	it("is 0 (shows 1/N) on the first card of a fresh session", () => {
		// 6 songs, none resolved → position 0 → header "1/6".
		expect(deriveProgressIndex(6, 6)).toBe(0);
	});

	it("climbs as cards resolve while total holds steady (regression: 1/6 → 2/6 → 3/6)", () => {
		const total = 6;
		// Each resolve drops one item from the unresolved list. The numerator
		// (index + 1) must climb 1 → 2 → 3 …; previously it stayed pinned at 1 while
		// the denominator counted DOWN (6 → 5 → 4) because both used the unresolved
		// list.
		expect(deriveProgressIndex(total, 6) + 1).toBe(1);
		expect(deriveProgressIndex(total, 5) + 1).toBe(2);
		expect(deriveProgressIndex(total, 4) + 1).toBe(3);
		expect(deriveProgressIndex(total, 1) + 1).toBe(6);
	});

	it("resumes at the right position when prior-session cards are already resolved", () => {
		// 6 total, 2 resolved before this session → 4 unresolved → position 2 → "3/6".
		expect(deriveProgressIndex(6, 4)).toBe(2);
	});

	it("holds the position when new matches append (total and unresolved both grow)", () => {
		// On song 3 of 6 (4 unresolved). Two new matches append: total 6 → 8,
		// unresolved 4 → 6. Still song 3, now of 8.
		expect(deriveProgressIndex(6, 4)).toBe(2);
		expect(deriveProgressIndex(8, 6)).toBe(2);
	});

	it("clamps at 0 when the unresolved list is briefly longer than total", () => {
		// Transient snapshot where an append lands before total updates.
		expect(deriveProgressIndex(5, 6)).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// deriveEmptyStateReason — single derivation for both no-queue and caught-up branches
//
// Truth table (old output = what match.tsx produced before; new output = deriveEmptyStateReason):
//
// hasQueue | caughtUp | isJobsActive | firstVisibleMatchReady | total | hiddenReviewItemCount | old       | new
// false    | N/A      | true         | false                  | N/A   | N/A                   | building  | building
// false    | N/A      | false        | false                  | N/A   | N/A                   | no-context| no-context
// false    | N/A      | false        | true                   | N/A   | N/A                   | building  | building
// false    | N/A      | true         | true                   | N/A   | N/A                   | building  | building
// true     | true     | true         | false                  | 0     | N/A                   | building  | building
// true     | true     | true         | true                   | 0     | N/A                   | building-more | building-more
// true     | true     | true         | false                  | 5     | N/A                   | building-more | building-more
// true     | true     | true         | true                   | 5     | N/A                   | building-more | building-more
// true     | true     | false        | N/A                    | 5     | 3                     | filtered  | filtered
// true     | true     | false        | N/A                    | 0     | 0                     | none-yet  | none-yet
// true     | true     | false        | N/A                    | 5     | 0                     | caught-up | caught-up
// ---------------------------------------------------------------------------

// Shared base for no-queue signals (only hasQueue matters for the no-queue branch).
const noQueue = {
	hasQueue: false as const,
	caughtUp: false as const,
	total: 0,
	hiddenReviewItemCount: 0,
};
// Shared base for caught-up signals.
const withQueue = {
	hasQueue: true as const,
	caughtUp: true as const,
};

describe("deriveEmptyStateReason — no-queue branch (hasQueue=false)", () => {
	it("returns 'building' when jobs are active (first-match setup running)", () => {
		expect(
			deriveEmptyStateReason({
				...noQueue,
				isJobsActive: true,
				firstVisibleMatchReady: false,
			}),
		).toBe("building");
	});

	it("returns 'no-context' only when jobs are idle AND no card is ready (genuine no-setup)", () => {
		expect(
			deriveEmptyStateReason({
				...noQueue,
				isJobsActive: false,
				firstVisibleMatchReady: false,
			}),
		).toBe("no-context");
	});

	it("returns 'building' when a first-visible card is ready but no session exists (recovery)", () => {
		// Loader bootstrapped before snapshot published; recovery effect is creating
		// the session. "building" bridges the gap so the page never flashes no-context.
		expect(
			deriveEmptyStateReason({
				...noQueue,
				isJobsActive: true,
				firstVisibleMatchReady: true,
			}),
		).toBe("building");
	});

	it("returns 'building' when jobs are idle but a card is ready (post-completion recovery)", () => {
		expect(
			deriveEmptyStateReason({
				...noQueue,
				isJobsActive: false,
				firstVisibleMatchReady: true,
			}),
		).toBe("building");
	});
});

describe("deriveEmptyStateReason — caught-up branch (hasQueue=true, caughtUp=true)", () => {
	it("returns 'building' when jobs active, no visible match ready, and total=0", () => {
		// Pure first-match bootstrap: jobs running, nothing surfaced yet.
		expect(
			deriveEmptyStateReason({
				...withQueue,
				isJobsActive: true,
				firstVisibleMatchReady: false,
				total: 0,
				hiddenReviewItemCount: 0,
			}),
		).toBe("building");
	});

	it("returns 'building-more' when jobs active and firstVisibleMatchReady=true (total=0)", () => {
		// Jobs running but a match already exists — more are being found.
		expect(
			deriveEmptyStateReason({
				...withQueue,
				isJobsActive: true,
				firstVisibleMatchReady: true,
				total: 0,
				hiddenReviewItemCount: 0,
			}),
		).toBe("building-more");
	});

	it("returns 'building-more' when jobs active and total>0 (firstVisibleMatchReady=false)", () => {
		// Queue had items (total>0) and jobs are still running.
		expect(
			deriveEmptyStateReason({
				...withQueue,
				isJobsActive: true,
				firstVisibleMatchReady: false,
				total: 5,
				hiddenReviewItemCount: 0,
			}),
		).toBe("building-more");
	});

	it("returns 'building-more' when jobs active, firstVisibleMatchReady=true, total>0", () => {
		expect(
			deriveEmptyStateReason({
				...withQueue,
				isJobsActive: true,
				firstVisibleMatchReady: true,
				total: 5,
				hiddenReviewItemCount: 0,
			}),
		).toBe("building-more");
	});

	it("returns 'filtered' when jobs idle and hiddenReviewItemCount>0", () => {
		// Songs with matches just under the strictness bar — loosen to recover.
		expect(
			deriveEmptyStateReason({
				...withQueue,
				isJobsActive: false,
				firstVisibleMatchReady: false,
				total: 5,
				hiddenReviewItemCount: 3,
			}),
		).toBe("filtered");
	});

	it("returns 'none-yet' when jobs idle, total=0, hiddenReviewItemCount=0", () => {
		// Matching ran but surfaced nothing — distinct from caught-up.
		expect(
			deriveEmptyStateReason({
				...withQueue,
				isJobsActive: false,
				firstVisibleMatchReady: false,
				total: 0,
				hiddenReviewItemCount: 0,
			}),
		).toBe("none-yet");
	});

	it("returns 'caught-up' when jobs idle, total>0, hiddenReviewItemCount=0", () => {
		// Worked through a real pile — all decided.
		expect(
			deriveEmptyStateReason({
				...withQueue,
				isJobsActive: false,
				firstVisibleMatchReady: false,
				total: 5,
				hiddenReviewItemCount: 0,
			}),
		).toBe("caught-up");
	});
});

// ---------------------------------------------------------------------------
// shouldBootstrapReadyQueue — re-run the one-shot bootstrap when a match is ready
// ---------------------------------------------------------------------------

describe("shouldBootstrapReadyQueue", () => {
	it("bootstraps when there is no session but a first-visible match is ready", () => {
		// The exact stranded state: loader ran before the snapshot existed, a match
		// is now ready, and nothing else would create the session.
		expect(
			shouldBootstrapReadyQueue({
				hasQueue: false,
				firstVisibleMatchReady: true,
			}),
		).toBe(true);
	});

	it("does not bootstrap while no first-visible match is ready yet", () => {
		expect(
			shouldBootstrapReadyQueue({
				hasQueue: false,
				firstVisibleMatchReady: false,
			}),
		).toBe(false);
	});

	it("does not bootstrap once a session already exists", () => {
		expect(
			shouldBootstrapReadyQueue({
				hasQueue: true,
				firstVisibleMatchReady: true,
			}),
		).toBe(false);
	});
});

describe("shouldOfferLoosenStrictness", () => {
	it("offers the loosen-strictness affordance only for no-visible-suggestions (A1)", () => {
		expect(shouldOfferLoosenStrictness("no-visible-suggestions")).toBe(true);
	});

	it("does not offer it for entitlement/data reasons — those are not recoverable by strictness", () => {
		for (const reason of [
			"not-entitled",
			"missing-song",
			"snapshot-not-owned",
			"already-resolved",
		]) {
			expect(shouldOfferLoosenStrictness(reason)).toBe(false);
		}
	});
});
