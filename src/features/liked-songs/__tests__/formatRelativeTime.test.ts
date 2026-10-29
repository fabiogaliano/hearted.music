import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatRelativeTime } from "../types";

describe("formatRelativeTime", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-10-29T12:00:00Z"));
	});
	afterEach(() => vi.useRealTimers());

	it("regression: a single week, month or year reads singular (was '1 weeks/months/years ago')", () => {
		expect(formatRelativeTime("2026-10-20T12:00:00Z")).toBe("1 week ago");
		expect(formatRelativeTime("2026-09-25T12:00:00Z")).toBe("1 month ago");
		expect(formatRelativeTime("2025-10-01T12:00:00Z")).toBe("1 year ago");
		expect(formatRelativeTime("2024-10-01T12:00:00Z")).toBe("2 years ago");
	});
});
