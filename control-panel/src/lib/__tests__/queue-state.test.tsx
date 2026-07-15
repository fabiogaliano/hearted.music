// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { type QueueConfig, useQueueState } from "../queue-state";

type Tab = "pending" | "approved" | "rejected";
type FilterKey = "signal";

const config: QueueConfig<Tab, FilterKey> = {
	storageKey: "test-queue",
	tabs: ["pending", "approved", "rejected"],
	defaultTab: "pending",
	filterKeys: ["signal"],
	filterDefaults: { signal: "all" },
	defaultOrder: "oldest",
};

function setUrl(search: string) {
	window.history.replaceState({}, "", `/${search}`);
}

describe("useQueueState", () => {
	beforeEach(() => {
		window.localStorage.clear();
		setUrl("");
	});

	it("reads tab, search, order, paging, and filters from the URL", () => {
		setUrl(
			"?view=approved&q=oasis&order=newest&page=3&pageSize=25&signal=genre",
		);
		const { result } = renderHook(() => useQueueState(config));
		expect(result.current.tab).toBe("approved");
		expect(result.current.q).toBe("oasis");
		expect(result.current.order).toBe("newest");
		expect(result.current.page).toBe(3);
		expect(result.current.pageSize).toBe(25);
		expect(result.current.filters.signal).toBe("genre");
	});

	it("falls back to defaults for absent/invalid params", () => {
		setUrl("?view=nonsense&order=sideways&page=0");
		const { result } = renderHook(() => useQueueState(config));
		expect(result.current.tab).toBe("pending");
		expect(result.current.order).toBe("oldest");
		expect(result.current.page).toBe(1);
		expect(result.current.pageSize).toBe(50);
		expect(result.current.filters.signal).toBe("all");
	});

	it("resets page and focus when the matching set changes", () => {
		setUrl("?page=5");
		const { result } = renderHook(() => useQueueState(config));
		act(() => result.current.setFocusIndex(4));
		expect(result.current.focusIndex).toBe(4);
		act(() => result.current.setSearch("adele"));
		expect(result.current.page).toBe(1);
		expect(result.current.focusIndex).toBe(0);
		expect(result.current.q).toBe("adele");
	});

	it("does not reset focus when only paging", () => {
		const { result } = renderHook(() => useQueueState(config));
		act(() => result.current.setFocusIndex(3));
		act(() => result.current.setPage(2));
		expect(result.current.page).toBe(2);
		expect(result.current.focusIndex).toBe(3);
	});

	it("builds shared list params for the fetch", () => {
		setUrl("?q=blur&order=newest&page=2&pageSize=100&signal=genre");
		const { result } = renderHook(() => useQueueState(config));
		const params = result.current.listParams;
		expect(params.get("q")).toBe("blur");
		expect(params.get("order")).toBe("newest");
		expect(params.get("page")).toBe("2");
		expect(params.get("pageSize")).toBe("100");
		expect(params.get("signal")).toBe("genre");
	});

	it("persists the mode preference across mounts", () => {
		const first = renderHook(() => useQueueState(config));
		expect(first.result.current.mode).toBe("focus");
		act(() => first.result.current.setMode("list"));
		first.unmount();
		const second = renderHook(() => useQueueState(config));
		expect(second.result.current.mode).toBe("list");
	});

	it("reset restores tab, search, order, filters, and page defaults", () => {
		setUrl("?view=approved&q=oasis&order=newest&page=4&signal=genre");
		const { result } = renderHook(() => useQueueState(config));
		act(() => result.current.reset());
		expect(result.current.tab).toBe("pending");
		expect(result.current.q).toBe("");
		expect(result.current.order).toBe("oldest");
		expect(result.current.page).toBe(1);
		expect(result.current.filters.signal).toBe("all");
	});
});
