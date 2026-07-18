import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockToast } = vi.hoisted(() => ({ mockToast: vi.fn() }));
vi.mock("sonner", () => ({ toast: mockToast }));

import { useMatchDeckSession } from "../useMatchDeckSession";

describe("useMatchDeckSession", () => {
	beforeEach(() => {
		mockToast.mockReset();
	});

	it("seeds currentItemId from initialItemId and resolves it against itemIds", () => {
		const { result } = renderHook(() =>
			useMatchDeckSession(["item-1", "item-2"], 2, "item-1"),
		);

		expect(result.current.state.currentItemId).toBe("item-1");
		expect(result.current.resolvedCurrentItemId).toBe("item-1");
	});

	it("falls back to the first unresolved item when the tracked id drops out of itemIds", () => {
		const { result, rerender } = renderHook(
			({ itemIds }: { itemIds: string[] }) =>
				useMatchDeckSession(itemIds, itemIds.length, "item-1"),
			{ initialProps: { itemIds: ["item-1", "item-2"] } },
		);

		expect(result.current.resolvedCurrentItemId).toBe("item-1");

		// item-1 resolved via an action and dropped from the deck's unresolved list.
		rerender({ itemIds: ["item-2"] });
		expect(result.current.resolvedCurrentItemId).toBe("item-2");
	});

	it("recordAddition appends to addedTo and folds the stat key into songsWithAdditions", () => {
		const { result } = renderHook(() =>
			useMatchDeckSession(["item-1"], 1, "item-1"),
		);

		act(() => result.current.actions.recordAddition("playlist-a", "song-1"));

		expect(result.current.state.addedTo).toEqual(["playlist-a"]);
		expect(result.current.state.sessionStats.addedCount).toBe(1);
		expect(
			result.current.state.sessionStats.songsWithAdditions.has("song-1"),
		).toBe(true);
	});

	it("recordAddition without a stat key bumps addedCount but not songsWithAdditions", () => {
		const { result } = renderHook(() =>
			useMatchDeckSession(["item-1"], 1, "item-1"),
		);

		act(() => result.current.actions.recordAddition("playlist-a"));

		expect(result.current.state.sessionStats.addedCount).toBe(1);
		expect(result.current.state.sessionStats.songsWithAdditions.size).toBe(0);
	});

	it("clearAddedTo resets addedTo without touching stats", () => {
		const { result } = renderHook(() =>
			useMatchDeckSession(["item-1"], 1, "item-1"),
		);

		act(() => result.current.actions.recordAddition("playlist-a", "song-1"));
		act(() => result.current.actions.clearAddedTo());

		expect(result.current.state.addedTo).toEqual([]);
		expect(result.current.state.sessionStats.addedCount).toBe(1);
	});

	it("recordPastItem dedups by id", () => {
		const { result } = renderHook(() =>
			useMatchDeckSession(["item-1"], 1, "item-1"),
		);

		const item = {
			id: "song-1",
			albumArtUrl: null,
			name: "Song",
			artist: "Artist",
		};
		act(() => result.current.actions.recordPastItem(item));
		act(() => result.current.actions.recordPastItem(item));

		expect(result.current.state.pastItems).toEqual([item]);
	});

	it("recordSkip and recordDismissal bump their own counters independently", () => {
		const { result } = renderHook(() =>
			useMatchDeckSession(["item-1"], 1, "item-1"),
		);

		act(() => result.current.actions.recordSkip());
		act(() => result.current.actions.recordDismissal());
		act(() => result.current.actions.recordSkip());

		expect(result.current.state.sessionStats.skippedCount).toBe(2);
		expect(result.current.state.sessionStats.dismissedCount).toBe(1);
	});

	it("advanceTo moves the tracked pointer, including to null (caught up)", () => {
		const { result } = renderHook(() => useMatchDeckSession([], 2, "item-1"));

		act(() => result.current.actions.advanceTo("item-2"));
		expect(result.current.state.currentItemId).toBe("item-2");

		act(() => result.current.actions.advanceTo(null));
		expect(result.current.state.currentItemId).toBeNull();
		// Empty itemIds (fully caught up) — no fallback candidate exists.
		expect(result.current.resolvedCurrentItemId).toBeNull();
	});

	it("lockNavigation claims the lock once; a second call before release returns false", () => {
		const { result } = renderHook(() =>
			useMatchDeckSession(["item-1"], 1, "item-1"),
		);

		let firstClaim = false;
		let secondClaim = false;
		act(() => {
			firstClaim = result.current.actions.lockNavigation();
			secondClaim = result.current.actions.lockNavigation();
		});

		expect(firstClaim).toBe(true);
		expect(secondClaim).toBe(false);
		expect(result.current.state.navigationStatus).toBe("pending");
	});

	it("releaseNavigation clears the lock so a subsequent lockNavigation succeeds", () => {
		const { result } = renderHook(() =>
			useMatchDeckSession(["item-1"], 1, "item-1"),
		);

		act(() => {
			result.current.actions.lockNavigation();
		});
		act(() => {
			result.current.actions.releaseNavigation();
		});

		expect(result.current.state.navigationStatus).toBe("idle");

		let reclaimed = false;
		act(() => {
			reclaimed = result.current.actions.lockNavigation();
		});
		expect(reclaimed).toBe(true);
	});

	it("fires a new-items toast when total grows across renders (append-only), not on unchanged total", () => {
		const { rerender } = renderHook(
			({ total }: { total: number }) =>
				useMatchDeckSession(["item-1"], total, "item-1"),
			{ initialProps: { total: 3 } },
		);

		expect(mockToast).not.toHaveBeenCalled();

		rerender({ total: 3 });
		expect(mockToast).not.toHaveBeenCalled();

		rerender({ total: 5 });
		expect(mockToast).toHaveBeenCalledTimes(1);
		expect(mockToast.mock.calls[0][0]).toContain("2 new");
	});
});
