import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@/test/utils/render";

const capture = vi.fn();

vi.mock("@posthog/react", () => ({
	usePostHog: () => ({ capture, identify: vi.fn(), reset: vi.fn() }),
}));

import { EVENT_SCHEMA_VERSION } from "../product-events";
import { useAnalytics } from "../useAnalytics";

describe("useAnalytics", () => {
	beforeEach(() => {
		capture.mockClear();
	});

	it("stamps the schema version onto every product event alongside the caller's properties", () => {
		const { result } = renderHook(() => useAnalytics());

		result.current.capture("onboarding_completed", { songs: 12, playlists: 3 });
		result.current.capture("user_logged_out");

		// Without the stamp, events can't be attributed to a property contract
		// once EVENT_SCHEMA_VERSION is bumped.
		expect(capture).toHaveBeenNthCalledWith(
			1,
			"onboarding_completed",
			{ schema_version: EVENT_SCHEMA_VERSION, songs: 12, playlists: 3 },
			undefined,
		);
		expect(capture).toHaveBeenNthCalledWith(
			2,
			"user_logged_out",
			{ schema_version: EVENT_SCHEMA_VERSION },
			undefined,
		);
	});

	it("keeps the schema_version stamp when caller properties carry their own schema_version (stamp was spread first and got clobbered)", () => {
		const { result } = renderHook(() => useAnalytics());

		// The cast models an untyped caller (e.g. spreading a loose object) that
		// the event map can't stop at compile time.
		result.current.capture("onboarding_completed", {
			songs: 1,
			playlists: 1,
			schema_version: 999,
		} as never);

		expect(capture).toHaveBeenCalledWith(
			"onboarding_completed",
			{ schema_version: EVENT_SCHEMA_VERSION, songs: 1, playlists: 1 },
			undefined,
		);
	});
});
