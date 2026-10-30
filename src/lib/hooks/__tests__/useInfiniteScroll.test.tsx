import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useInfiniteScroll } from "../useInfiniteScroll";

const observers: MockIntersectionObserver[] = [];

class MockIntersectionObserver implements IntersectionObserver {
	readonly root: Element | Document | null;
	readonly rootMargin: string;
	readonly scrollMargin = "0px";
	readonly thresholds: readonly number[];
	readonly observe = vi.fn();
	readonly unobserve = vi.fn();
	readonly disconnect = vi.fn();

	constructor(
		private readonly callback: IntersectionObserverCallback,
		options?: IntersectionObserverInit,
	) {
		this.root = options?.root ?? null;
		this.rootMargin = options?.rootMargin ?? "0px";
		this.thresholds = Array.isArray(options?.threshold)
			? options.threshold
			: [options?.threshold ?? 0];
		observers.push(this);
	}

	takeRecords(): IntersectionObserverEntry[] {
		return [];
	}

	trigger(isIntersecting: boolean, target: Element) {
		const rect = DOMRectReadOnly.fromRect();
		const entry: IntersectionObserverEntry = {
			time: 0,
			target,
			rootBounds: null,
			boundingClientRect: rect,
			intersectionRect: rect,
			intersectionRatio: isIntersecting ? 1 : 0,
			isIntersecting,
		};

		this.callback([entry], this);
	}
}

function latestObserver(): MockIntersectionObserver {
	const observer = observers.at(-1);
	if (observer === undefined) {
		throw new Error("Expected an IntersectionObserver to be created");
	}
	return observer;
}

function getObserver(): MockIntersectionObserver {
	const observer = observers[0];
	if (observer === undefined) {
		throw new Error("Expected an IntersectionObserver to be created");
	}
	return observer;
}

beforeEach(() => {
	observers.length = 0;
	vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("useInfiniteScroll", () => {
	it("observes the sentinel when it is rendered after the hook effect ran", async () => {
		const onLoadMore = vi.fn();
		const node = document.createElement("div");
		const { result } = renderHook(() =>
			useInfiniteScroll({ onLoadMore, hasMore: true }),
		);

		expect(observers).toHaveLength(0);

		act(() => {
			result.current.sentinelRef(node);
		});

		await waitFor(() => {
			expect(getObserver().observe).toHaveBeenCalledWith(node);
		});

		getObserver().trigger(true, node);

		expect(onLoadMore).toHaveBeenCalledTimes(1);
	});

	it("checks the sentinel again once a page lands, so a list whose sentinel stays in range doesn't stall", async () => {
		const onLoadMore = vi.fn();
		const node = document.createElement("div");
		const { result, rerender } = renderHook(
			({ itemCount }) =>
				useInfiniteScroll({ onLoadMore, hasMore: true, itemCount }),
			{ initialProps: { itemCount: 50 } },
		);
		act(() => {
			result.current.sentinelRef(node);
		});
		await waitFor(() => expect(observers).toHaveLength(1));

		rerender({ itemCount: 100 });

		await waitFor(() => expect(observers).toHaveLength(2));
		expect(observers[0].disconnect).toHaveBeenCalled();
		// A fresh observer reports the current intersection on observe, which is
		// what a still-in-range sentinel needs to request the next page.
		latestObserver().trigger(true, node);
		expect(onLoadMore).toHaveBeenCalledTimes(1);
	});

	it("regression: doesn't re-request a page whose load failed until the sentinel re-enters (re-observing after every load retried a failing page in a loop)", async () => {
		const node = document.createElement("div");
		const { result, rerender } = renderHook(
			({ itemCount }) =>
				useInfiniteScroll({ onLoadMore: vi.fn(), hasMore: true, itemCount }),
			{ initialProps: { itemCount: 50 } },
		);
		act(() => {
			result.current.sentinelRef(node);
		});
		await waitFor(() => expect(observers).toHaveLength(1));

		rerender({ itemCount: 50 });

		expect(observers).toHaveLength(1);
		expect(observers[0].disconnect).not.toHaveBeenCalled();
	});

	it("measures the margin against the nearest scroll container, not the viewport", async () => {
		const scroller = document.createElement("div");
		scroller.style.overflowY = "auto";
		const node = document.createElement("div");
		scroller.append(node);
		document.body.append(scroller);
		const { result } = renderHook(() =>
			useInfiniteScroll({
				onLoadMore: vi.fn(),
				hasMore: true,
				threshold: 1500,
			}),
		);

		act(() => {
			result.current.sentinelRef(node);
		});

		await waitFor(() => expect(observers).toHaveLength(1));
		expect(getObserver().root).toBe(scroller);
		expect(getObserver().rootMargin).toBe("1500px 0px");
		scroller.remove();
	});
});
