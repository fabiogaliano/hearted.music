import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSongAddHighlight } from "../useSongAddHighlight";

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

const NO_SONGS: { id: string }[] = [];

describe("useSongAddHighlight", () => {
	it("starts the expiry only when the added song reaches the preview", () => {
		const { result, rerender } = renderHook(
			({ songs }: { songs: { id: string }[] }) => useSongAddHighlight(songs),
			{ initialProps: { songs: NO_SONGS } },
		);

		act(() => result.current.markSongAdded("song-1"));
		expect(result.current.newSongIds.has("song-1")).toBe(true);

		act(() => vi.advanceTimersByTime(1500));
		expect(result.current.newSongIds.has("song-1")).toBe(true);

		rerender({ songs: [{ id: "song-1" }] });
		act(() => vi.advanceTimersByTime(1499));
		expect(result.current.newSongIds.has("song-1")).toBe(true);

		act(() => vi.advanceTimersByTime(1));
		expect(result.current.newSongIds.has("song-1")).toBe(false);
	});

	it("tracks overlapping song arrivals independently", () => {
		const { result, rerender } = renderHook(
			({ songs }: { songs: { id: string }[] }) => useSongAddHighlight(songs),
			{ initialProps: { songs: NO_SONGS } },
		);

		act(() => result.current.markSongAdded("song-1"));
		rerender({ songs: [{ id: "song-1" }] });
		act(() => vi.advanceTimersByTime(500));

		act(() => result.current.markSongAdded("song-2"));
		rerender({ songs: [{ id: "song-1" }, { id: "song-2" }] });
		act(() => vi.advanceTimersByTime(1000));

		expect(result.current.newSongIds.has("song-1")).toBe(false);
		expect(result.current.newSongIds.has("song-2")).toBe(true);
	});

	it("cleans up active expiry timers on unmount", () => {
		const { result, unmount } = renderHook(() =>
			useSongAddHighlight([{ id: "song-1" }]),
		);
		act(() => result.current.markSongAdded("song-1"));
		expect(vi.getTimerCount()).toBe(1);

		unmount();
		expect(vi.getTimerCount()).toBe(0);
	});
});
