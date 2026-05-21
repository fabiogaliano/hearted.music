import { describe, expect, it } from "vitest";
import { likedSongsInfiniteQueryOptions, likedSongsKeys } from "../queries";

describe("likedSongsKeys.infinite", () => {
	it("collapses undefined, null, empty, and whitespace search into a single key", () => {
		const filter = "all" as const;
		const base = JSON.stringify(likedSongsKeys.infinite(filter));

		expect(JSON.stringify(likedSongsKeys.infinite(filter, undefined))).toBe(
			base,
		);
		expect(JSON.stringify(likedSongsKeys.infinite(filter, null))).toBe(base);
		expect(JSON.stringify(likedSongsKeys.infinite(filter, ""))).toBe(base);
		expect(JSON.stringify(likedSongsKeys.infinite(filter, "   "))).toBe(base);
	});

	it("treats trimmed and untrimmed searches as the same key", () => {
		const filter = "all" as const;
		expect(
			JSON.stringify(likedSongsKeys.infinite(filter, "let it happen")),
		).toBe(
			JSON.stringify(likedSongsKeys.infinite(filter, "  let it happen  ")),
		);
	});

	it("yields distinct keys for different filter+search combinations", () => {
		const a = JSON.stringify(likedSongsKeys.infinite("all", "let it happen"));
		const b = JSON.stringify(
			likedSongsKeys.infinite("pending", "let it happen"),
		);
		const c = JSON.stringify(likedSongsKeys.infinite("all", "another song"));
		expect(a).not.toBe(b);
		expect(a).not.toBe(c);
		expect(b).not.toBe(c);
	});
});

describe("likedSongsInfiniteQueryOptions", () => {
	it("uses the normalized search in the query key", () => {
		const trimmed = likedSongsInfiniteQueryOptions("all", "  let it happen  ");
		const raw = likedSongsInfiniteQueryOptions("all", "let it happen");
		expect(JSON.stringify(trimmed.queryKey)).toBe(JSON.stringify(raw.queryKey));
	});

	it("uses the canonical no-search key when search is missing/blank", () => {
		const omitted = JSON.stringify(
			likedSongsInfiniteQueryOptions("all").queryKey,
		);
		expect(
			JSON.stringify(likedSongsInfiniteQueryOptions("all", "").queryKey),
		).toBe(omitted);
		expect(
			JSON.stringify(likedSongsInfiniteQueryOptions("all", "   ").queryKey),
		).toBe(omitted);
		expect(
			JSON.stringify(likedSongsInfiniteQueryOptions("all", null).queryKey),
		).toBe(omitted);
	});
});
