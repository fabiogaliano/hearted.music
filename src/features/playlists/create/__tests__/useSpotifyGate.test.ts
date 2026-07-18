/**
 * Tests for useSpotifyGate.
 *
 * Covers:
 *  - Mount check: not installed → extension-unavailable; installed but
 *    disconnected → reconnect-required; installed + connected → ok.
 *  - Re-check on window focus / document visibilitychange, but only while the
 *    gate is not ok; a healthy session never PINGs again.
 *  - The two events are coalesced into a single re-check.
 *  - Request-id race: a slower, older re-check resolving after a newer one must
 *    not clobber the newer state.
 *  - reportGateFailure forces a failure and invalidates an in-flight check.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockIsExtensionInstalled, mockGetSpotifyConnectionStatus } = vi.hoisted(
	() => ({
		mockIsExtensionInstalled: vi.fn(),
		mockGetSpotifyConnectionStatus: vi.fn(),
	}),
);

vi.mock("@/lib/extension/detect", () => ({
	isExtensionInstalled: () => mockIsExtensionInstalled(),
	getSpotifyConnectionStatus: () => mockGetSpotifyConnectionStatus(),
}));

import { useSpotifyGate } from "../useSpotifyGate";

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

beforeEach(() => {
	mockIsExtensionInstalled.mockReset();
	mockGetSpotifyConnectionStatus.mockReset();
});

describe("useSpotifyGate — mount check", () => {
	it("starts in checking", () => {
		mockIsExtensionInstalled.mockResolvedValue(false);
		const { result } = renderHook(() => useSpotifyGate());
		expect(result.current.gateState).toBe("checking");
	});

	it("resolves to extension-unavailable when not installed", async () => {
		mockIsExtensionInstalled.mockResolvedValue(false);
		const { result } = renderHook(() => useSpotifyGate());
		await waitFor(() =>
			expect(result.current.gateState).toBe("extension-unavailable"),
		);
		expect(mockGetSpotifyConnectionStatus).not.toHaveBeenCalled();
	});

	it("resolves to reconnect-required when installed but disconnected", async () => {
		mockIsExtensionInstalled.mockResolvedValue(true);
		mockGetSpotifyConnectionStatus.mockResolvedValue(false);
		const { result } = renderHook(() => useSpotifyGate());
		await waitFor(() =>
			expect(result.current.gateState).toBe("reconnect-required"),
		);
	});

	it("resolves to ok when installed and connected", async () => {
		mockIsExtensionInstalled.mockResolvedValue(true);
		mockGetSpotifyConnectionStatus.mockResolvedValue(true);
		const { result } = renderHook(() => useSpotifyGate());
		await waitFor(() => expect(result.current.gateState).toBe("ok"));
	});
});

describe("useSpotifyGate — automatic re-checks", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("re-checks on window focus while not ok and recovers to ok", async () => {
		mockIsExtensionInstalled.mockResolvedValue(true);
		mockGetSpotifyConnectionStatus.mockResolvedValue(false);
		const { result } = renderHook(() => useSpotifyGate());
		await act(async () => {});
		expect(result.current.gateState).toBe("reconnect-required");
		expect(mockIsExtensionInstalled).toHaveBeenCalledTimes(1);

		mockGetSpotifyConnectionStatus.mockResolvedValue(true);
		act(() => {
			window.dispatchEvent(new Event("focus"));
		});
		await act(async () => {
			vi.advanceTimersByTime(200);
		});

		expect(result.current.gateState).toBe("ok");
		expect(mockIsExtensionInstalled).toHaveBeenCalledTimes(2);
	});

	it("coalesces focus + visibilitychange into a single re-check", async () => {
		mockIsExtensionInstalled.mockResolvedValue(true);
		mockGetSpotifyConnectionStatus.mockResolvedValue(false);
		const { result } = renderHook(() => useSpotifyGate());
		await act(async () => {});
		expect(mockIsExtensionInstalled).toHaveBeenCalledTimes(1);

		act(() => {
			window.dispatchEvent(new Event("focus"));
			document.dispatchEvent(new Event("visibilitychange"));
		});
		await act(async () => {
			vi.advanceTimersByTime(200);
		});

		// One mount check + one coalesced re-check — not two re-checks.
		expect(mockIsExtensionInstalled).toHaveBeenCalledTimes(2);
		expect(result.current.gateState).toBe("reconnect-required");
	});

	it("stops re-checking once ok — a healthy session never PINGs again", async () => {
		mockIsExtensionInstalled.mockResolvedValue(true);
		mockGetSpotifyConnectionStatus.mockResolvedValue(true);
		const { result } = renderHook(() => useSpotifyGate());
		await act(async () => {});
		expect(result.current.gateState).toBe("ok");
		const callsAtOk = mockIsExtensionInstalled.mock.calls.length;

		act(() => {
			window.dispatchEvent(new Event("focus"));
			document.dispatchEvent(new Event("visibilitychange"));
		});
		await act(async () => {
			vi.advanceTimersByTime(1000);
		});

		expect(mockIsExtensionInstalled).toHaveBeenCalledTimes(callsAtOk);
	});
});

describe("useSpotifyGate — request-id race", () => {
	it("ignores an older re-check that resolves after a newer one", async () => {
		mockIsExtensionInstalled.mockResolvedValue(true);
		const older = deferred<boolean>();
		const newer = deferred<boolean>();
		mockGetSpotifyConnectionStatus
			.mockReturnValueOnce(older.promise)
			.mockReturnValueOnce(newer.promise);

		const { result } = renderHook(() => useSpotifyGate());
		// Let the mount check park awaiting the (older) connection status.
		await act(async () => {});
		expect(result.current.gateState).toBe("checking");

		// Kick a newer re-check; let it park awaiting the (newer) status.
		let pending!: Promise<void>;
		act(() => {
			pending = result.current.recheck();
		});
		await act(async () => {});

		// Newer resolves first → ok.
		await act(async () => {
			newer.resolve(true);
		});
		expect(result.current.gateState).toBe("ok");

		// Older resolves later with a stale "disconnected" — must NOT clobber ok.
		await act(async () => {
			older.resolve(false);
		});
		expect(result.current.gateState).toBe("ok");
		await pending;
	});
});

describe("useSpotifyGate — reportGateFailure", () => {
	it("forces a failure and an in-flight check can't overwrite it", async () => {
		mockIsExtensionInstalled.mockResolvedValue(true);
		const inFlight = deferred<boolean>();
		mockGetSpotifyConnectionStatus.mockReturnValueOnce(inFlight.promise);

		const { result } = renderHook(() => useSpotifyGate());
		await act(async () => {});
		expect(result.current.gateState).toBe("checking");

		act(() => {
			result.current.reportGateFailure("reconnect-required");
		});
		expect(result.current.gateState).toBe("reconnect-required");

		// The mount check finally resolves "connected" — but it was invalidated.
		await act(async () => {
			inFlight.resolve(true);
		});
		expect(result.current.gateState).toBe("reconnect-required");
	});
});
