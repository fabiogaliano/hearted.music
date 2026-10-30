import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useChunkOriginIndex } from "../components/LikedSongsList";

const rows = (...ids: string[]) => ids.map((id) => ({ track: { id } }));
const indexOf = (list: { track: { id: string } }[]) =>
	new Map(list.map((row, index) => [row.track.id, index]));

describe("useChunkOriginIndex", () => {
	it("keeps its origin row across a prepend", () => {
		const { result, rerender } = renderHook(
			({ list }) => useChunkOriginIndex(list, indexOf(list)),
			{ initialProps: { list: rows("a", "b", "c") } },
		);
		expect(result.current).toBe(0);

		rerender({ list: rows("z", "a", "b", "c") });

		expect(result.current).toBe(1);
	});

	it("hands the origin to the current first row once its own row leaves the list", () => {
		const { result, rerender } = renderHook(
			({ list }) => useChunkOriginIndex(list, indexOf(list)),
			{ initialProps: { list: rows("a", "b", "c") } },
		);

		rerender({ list: rows("b", "c") });
		expect(result.current).toBe(0);

		// b is the origin now, so a later prepend keeps measuring from b.
		rerender({ list: rows("y", "b", "c") });
		expect(result.current).toBe(1);
	});
});
