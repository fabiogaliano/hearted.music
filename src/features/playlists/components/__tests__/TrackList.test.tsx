import { describe, expect, it, vi } from "vitest";
import { makePlaylistTracks } from "@/test/fixtures";
import { render, screen } from "@/test/utils/render";
import { Cover } from "../Cover";
import { TrackList } from "../TrackList";

// Pass-through spy: each call is one track row rendering.
vi.mock("../Cover", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../Cover")>();
	return { Cover: vi.fn(actual.Cover) };
});

describe("TrackList", () => {
	it("regression: rows far down a long playlist aren't held invisible by the enter stagger (row 1,120 waited ~29 s)", () => {
		const tracks = makePlaylistTracks(1123);

		render(<TrackList tracks={tracks} songCount={tracks.length} />);

		// The early row proves the lookup reaches the styled row, so the deep
		// row's empty delay can't pass just because the markup moved.
		const earlyRow = screen.getByText("2").parentElement;
		const deepRow = screen.getByText("1120").parentElement;
		expect(earlyRow?.style.animationDelay).not.toBe("");
		expect(deepRow?.style.animationDelay).toBe("");
	});

	it("renders only the appended rows when a page of identity-stable tracks is appended", () => {
		const firstPage = makePlaylistTracks(200).slice(0, 100);
		const appended = [...firstPage, ...makePlaylistTracks(200).slice(100)];
		const { rerender } = render(
			<TrackList tracks={firstPage} songCount={200} />,
		);
		vi.mocked(Cover).mockClear();

		rerender(<TrackList tracks={appended} songCount={200} />);

		expect(Cover).toHaveBeenCalledTimes(100);
	});
});
