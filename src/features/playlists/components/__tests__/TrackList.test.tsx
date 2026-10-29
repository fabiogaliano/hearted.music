import { describe, expect, it } from "vitest";
import { makePlaylistTracks } from "@/test/fixtures";
import { render, screen } from "@/test/utils/render";
import { TrackList } from "../TrackList";

describe("TrackList", () => {
	it("regression: rows far down a long playlist aren't held invisible by the enter stagger (row 1,120 waited ~29 s)", () => {
		const tracks = makePlaylistTracks(1123);

		render(<TrackList tracks={tracks} songCount={tracks.length} />);

		const lastRow = screen.getByText("1120").parentElement;
		expect(lastRow?.style.animationDelay ?? "").toBe("");
	});
});
