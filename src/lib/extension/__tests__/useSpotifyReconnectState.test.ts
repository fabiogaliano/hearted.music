import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const { mockGetSpotifyConnectionStatus } = vi.hoisted(() => {
	const mockGetSpotifyConnectionStatus = vi.fn().mockResolvedValue(false);
	return { mockGetSpotifyConnectionStatus };
});

vi.mock("../detect", () => ({
	getSpotifyConnectionStatus: () => mockGetSpotifyConnectionStatus(),
}));

import { useSpotifyReconnectState } from "../useSpotifyReconnectState";

describe("useSpotifyReconnectState", () => {
	beforeEach(() => {
		mockGetSpotifyConnectionStatus.mockReset();
		mockGetSpotifyConnectionStatus.mockResolvedValue(false);
	});

	it("starts with reconnectNeeded false", () => {
		const { result } = renderHook(() => useSpotifyReconnectState("song-1"));
		expect(result.current.reconnectNeeded).toBe(false);
	});

	it("sets reconnectNeeded to true", () => {
		const { result } = renderHook(() => useSpotifyReconnectState("song-1"));
		act(() => result.current.setReconnectNeeded(true));
		expect(result.current.reconnectNeeded).toBe(true);
	});

	it("clears reconnectNeeded back to false", () => {
		const { result } = renderHook(() => useSpotifyReconnectState("song-1"));
		act(() => result.current.setReconnectNeeded(true));
		act(() => result.current.setReconnectNeeded(false));
		expect(result.current.reconnectNeeded).toBe(false);
	});

	it("resets to false when the entity key changes", () => {
		let entityKey = "song-1";
		const { result, rerender } = renderHook(() =>
			useSpotifyReconnectState(entityKey),
		);

		act(() => result.current.setReconnectNeeded(true));
		expect(result.current.reconnectNeeded).toBe(true);

		entityKey = "song-2";
		rerender();

		expect(result.current.reconnectNeeded).toBe(false);
	});

	it("does not reset when the entity key stays the same", () => {
		const { result, rerender } = renderHook(() =>
			useSpotifyReconnectState("song-1"),
		);
		act(() => result.current.setReconnectNeeded(true));
		rerender();
		expect(result.current.reconnectNeeded).toBe(true);
	});

	it("tracks independent state per instance", () => {
		const { result: a } = renderHook(() => useSpotifyReconnectState("song-1"));
		const { result: b } = renderHook(() => useSpotifyReconnectState("song-2"));

		act(() => a.current.setReconnectNeeded(true));

		expect(a.current.reconnectNeeded).toBe(true);
		expect(b.current.reconnectNeeded).toBe(false);
	});

	describe("token recovery polling", () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it("auto-clears reconnectNeeded when Spotify becomes connected", async () => {
			const { result } = renderHook(() => useSpotifyReconnectState("song-1"));

			act(() => result.current.setReconnectNeeded(true));
			expect(result.current.reconnectNeeded).toBe(true);

			mockGetSpotifyConnectionStatus.mockResolvedValue(true);

			await act(async () => {
				vi.advanceTimersByTime(3_000);
			});

			expect(result.current.reconnectNeeded).toBe(false);
		});

		it("does not poll when reconnectNeeded is false", async () => {
			renderHook(() => useSpotifyReconnectState("song-1"));

			await act(async () => {
				vi.advanceTimersByTime(10_000);
			});

			expect(mockGetSpotifyConnectionStatus).not.toHaveBeenCalled();
		});

		it("stops polling once reconnect state is cleared manually", async () => {
			const { result } = renderHook(() => useSpotifyReconnectState("song-1"));

			act(() => result.current.setReconnectNeeded(true));
			act(() => result.current.setReconnectNeeded(false));

			await act(async () => {
				vi.advanceTimersByTime(10_000);
			});

			expect(mockGetSpotifyConnectionStatus).not.toHaveBeenCalled();
		});

		it("continues polling until connection returns", async () => {
			const { result } = renderHook(() => useSpotifyReconnectState("song-1"));

			act(() => result.current.setReconnectNeeded(true));

			await act(async () => {
				vi.advanceTimersByTime(6_000); // two poll ticks, still disconnected
			});

			expect(result.current.reconnectNeeded).toBe(true);
			expect(mockGetSpotifyConnectionStatus).toHaveBeenCalledTimes(2);

			mockGetSpotifyConnectionStatus.mockResolvedValue(true);

			await act(async () => {
				vi.advanceTimersByTime(3_000); // third tick — now connected
			});

			expect(result.current.reconnectNeeded).toBe(false);
		});
	});
});
