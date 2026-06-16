import { describe, expect, it } from "vitest";
import type { MatchReviewResult } from "@/lib/server/match-review-queue.functions";
import {
	countAppendedFromTotal,
	deriveCaughtUp,
	deriveUnresolvedIds,
	nextItemIdAfterResolved,
	resolveCurrentItemId,
} from "../queue-helpers";

function makeQueue(
	overrides: Partial<MatchReviewResult> = {},
): MatchReviewResult {
	return {
		sessionId: "session-1",
		items: [],
		total: 0,
		caughtUp: false,
		...overrides,
	};
}

function makeItem(
	id: string,
	position: number,
	state: "pending" | "presented" | "completed" | "skipped" | "unavailable",
) {
	return {
		id,
		position,
		state,
		songId: `song-${id}`,
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
				makeItem("a", 0, "completed"),
				makeItem("b", 1, "skipped"),
				makeItem("c", 2, "unavailable"),
			],
		});
		expect(deriveUnresolvedIds(queue)).toEqual([]);
	});

	it("returns only pending and presented items, sorted by position", () => {
		const queue = makeQueue({
			items: [
				makeItem("a", 2, "pending"),
				makeItem("b", 0, "presented"),
				makeItem("c", 1, "completed"),
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
