/**
 * §13.3 — UnreadState predicate: resolved-unknown vs in-flight.
 *
 * Verifies that:
 * - An unknown song (contentFetchStatus: "not_found", no read, no analysis row)
 *   renders "No words yet" — not "Listening".
 * - A genuinely in-flight song (no fetch outcome yet) renders "Listening".
 * - A song with fetch = "lyrics" but no read yet (read arriving) renders "Listening".
 * - Lyrical and instrumental reads are unaffected (their layers render instead of
 *   UnreadState, so the "Listening"/"No words yet" copy does not appear at all).
 * - isEnrichmentRunning does not override a settled not_found: the song remains
 *   "No words yet" even when the pipeline is running.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SongDetailPanelSurface } from "../SongDetailPanelSurface";
import type { SongDetail } from "../song-detail-types";

// Minimal SongDetail fixture. No read, no instrumentalRead by default — routes
// the render into UnreadState.
function makeDetail(overrides: Partial<SongDetail> = {}): SongDetail {
	return {
		id: "track-1",
		spotifyTrackId: "spotify-1",
		title: "Saw You for the First Time",
		artist: "Laurence Guy",
		album: "Found a Place",
		genres: [],
		audioFeatures: { tempo: null, energy: null, valence: null },
		theme: "green",
		read: null,
		instrumentalRead: null,
		displayState: "pending",
		contentFetchStatus: null,
		...overrides,
	};
}

describe("SongDetailPanelSurface — UnreadState: resolved-unknown (§13.3)", () => {
	it("renders 'No words yet' when fetch settled to not_found and there is no read", () => {
		const detail = makeDetail({
			displayState: "pending",
			contentFetchStatus: "not_found",
		});

		render(<SongDetailPanelSurface song={detail} />);

		expect(screen.getByText("No words yet")).toBeInTheDocument();
		expect(screen.queryByText("Listening")).toBeNull();
	});

	it("renders 'No words yet' even when isEnrichmentRunning=true (settled not_found overrides pipeline signal)", () => {
		const detail = makeDetail({
			displayState: "pending",
			contentFetchStatus: "not_found",
		});

		render(<SongDetailPanelSurface song={detail} isEnrichmentRunning={true} />);

		expect(screen.getByText("No words yet")).toBeInTheDocument();
		expect(screen.queryByText("Listening")).toBeNull();
	});

	it("renders 'No words yet' when fetch settled to instrumental but no read parsed", () => {
		const detail = makeDetail({
			displayState: "pending",
			contentFetchStatus: "instrumental",
		});

		render(<SongDetailPanelSurface song={detail} />);

		expect(screen.getByText("No words yet")).toBeInTheDocument();
	});
});

describe("SongDetailPanelSurface — UnreadState: in-flight (§13.3)", () => {
	it("renders 'Listening' when no fetch outcome has been recorded yet", () => {
		const detail = makeDetail({
			displayState: "pending",
			contentFetchStatus: null,
		});

		render(<SongDetailPanelSurface song={detail} />);

		expect(screen.getByText("Listening")).toBeInTheDocument();
		expect(screen.queryByText("No words yet")).toBeNull();
	});

	it("renders 'Listening' when fetch returned lyrics but the read has not arrived yet", () => {
		const detail = makeDetail({
			displayState: "pending",
			contentFetchStatus: "lyrics",
			read: null,
		});

		render(<SongDetailPanelSurface song={detail} />);

		expect(screen.getByText("Listening")).toBeInTheDocument();
	});

	it("renders 'Listening' when the pipeline is running and no fetch outcome is settled", () => {
		const detail = makeDetail({
			displayState: "pending",
			contentFetchStatus: null,
		});

		render(<SongDetailPanelSurface song={detail} isEnrichmentRunning={true} />);

		expect(screen.getByText("Listening")).toBeInTheDocument();
	});
});

describe("SongDetailPanelSurface — read/instrumentalRead paths unchanged (§13.3)", () => {
	it("renders the lyrical read image (not Listening or No words yet) for a lyrical song", () => {
		const detail = makeDetail({
			displayState: "analyzed",
			contentFetchStatus: "lyrics",
			read: {
				image: "the long way home, alone this time",
				lens: "license as eulogy",
				tension: "Aching Disbelief",
				take: "She passed the test she swore she would pass for him.",
				contradiction: null,
				arc: [],
				lines: [{ line: "I got my driver's license like I told you I would" }],
				texture: "A ballad that grows a spine.",
			},
		});

		render(<SongDetailPanelSurface song={detail} />);

		expect(
			screen.getByText("the long way home, alone this time"),
		).toBeInTheDocument();
		expect(screen.queryByText("Listening")).toBeNull();
		expect(screen.queryByText("No words yet")).toBeNull();
	});

	it("renders the instrumental read headline (not Listening or No words yet) for an instrumental song", () => {
		const detail = makeDetail({
			displayState: "analyzed",
			contentFetchStatus: "instrumental",
			instrumentalRead: {
				headline: "The texture of arriving nowhere in particular",
				compound_mood: "Ambient Drift",
				sonic_texture: "Deep Electronic",
				mood_description:
					"A slow unwinding, like watching city lights from a moving train at 3am.",
			},
		});

		render(<SongDetailPanelSurface song={detail} />);

		expect(
			screen.getByText("The texture of arriving nowhere in particular"),
		).toBeInTheDocument();
		expect(screen.queryByText("Listening")).toBeNull();
		expect(screen.queryByText("No words yet")).toBeNull();
	});
});
