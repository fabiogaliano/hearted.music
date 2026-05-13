import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useInfiniteScroll } from "../hooks/useInfiniteScroll";

const observers: MockIntersectionObserver[] = [];

class MockIntersectionObserver implements IntersectionObserver {
	readonly root: Element | Document | null;
	readonly rootMargin: string;
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
});
