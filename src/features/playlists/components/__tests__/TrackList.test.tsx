import { describe, expect, it } from "vitest";
import { makePlaylistTracks } from "@/test/fixtures";
import { render, screen } from "@/test/utils/render";
import { TrackList } from "../TrackList";

describe("TrackList", () => {
	it("regression: rows far down a long playlist aren't held invisible by the enter stagger (row 1,120 waited ~29 s)", () => {
		const tracks = makePlaylistTracks(1123);

		render(<TrackList tracks={tracks} songCount={tracks.length} />);

		const earlyRow = screen.getByText("2").parentElement;
		const boundaryRow = screen.getByText("15").parentElement; // first non-staggered row (STAGGERED_ROWS = 14)
		expect(earlyRow).not.toBeNull();
		expect(boundaryRow).not.toBeNull();
		expect(earlyRow?.style.animationDelay).not.toBe("");
		expect(boundaryRow?.style.animationDelay).toBe("");
	});
});
