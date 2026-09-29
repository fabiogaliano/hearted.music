/**
 * §13.3 — an unlocked song with no read is either in-flight ("analyzing") or
 * settled without words ("unavailable"). The derivation lives in
 * `unreadStatus`; the surface only routes to it when neither read exists.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@/test/utils/render";
import { SongDetailPanelSurface } from "../SongDetailPanelSurface";
import type { SongDetail } from "../song-detail-types";
import { unreadStatus } from "../unread-status";

describe("unreadStatus (§13.3)", () => {
	it("settled not_found stays unavailable even while enrichment runs — the 'Listening forever' resolved-unknown bug", () => {
		// display_state stays 'pending' for a resolved-unknown song because no
		// analysis row is ever written; only the settled fetch breaks the loop.
		expect(
			unreadStatus({
				displayState: "pending",
				contentFetchStatus: "not_found",
				isEnrichmentRunning: true,
			}),
		).toBe("unavailable");
		expect(
			unreadStatus({
				displayState: "pending",
				contentFetchStatus: "not_found",
			}),
		).toBe("unavailable");
	});

	it.each([
		// Fetch settled to instrumental but no read parsed: nothing is coming.
		[
			{ displayState: "pending", contentFetchStatus: "instrumental" },
			"unavailable",
		],
		// No fetch outcome yet on a pending song: genuinely in-flight.
		[{ displayState: "pending", contentFetchStatus: null }, "analyzing"],
		// Lyrics found, read not generated yet.
		[{ displayState: "pending", contentFetchStatus: "lyrics" }, "analyzing"],
		// Nothing settled and the song itself isn't pending, but the pipeline is.
		[
			{
				displayState: "analyzed",
				contentFetchStatus: null,
				isEnrichmentRunning: true,
			},
			"analyzing",
		],
		// Analysis ran and produced nothing parseable, pipeline idle.
		[{ displayState: "analyzed", contentFetchStatus: null }, "unavailable"],
	] as const)("%o → %s", (input, expected) => {
		expect(unreadStatus(input)).toBe(expected);
	});
});

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

describe("SongDetailPanelSurface — a present read wins over the unread state", () => {
	it("renders the lyrical read for a lyrical song", () => {
		render(
			<SongDetailPanelSurface
				song={makeDetail({
					displayState: "analyzed",
					contentFetchStatus: "lyrics",
					read: {
						image: "the long way home, alone this time",
						lens: "license as eulogy",
						tension: "Aching Disbelief",
						take: "She passed the test she swore she would pass for him.",
						contradiction: null,
						arc: [],
						lines: [
							{ line: "I got my driver's license like I told you I would" },
						],
						texture: "A ballad that grows a spine.",
					},
				})}
			/>,
		);

		expect(
			screen.getByText("the long way home, alone this time"),
		).toBeInTheDocument();
	});

	it("renders the instrumental read for an instrumental song", () => {
		render(
			<SongDetailPanelSurface
				song={makeDetail({
					displayState: "analyzed",
					contentFetchStatus: "instrumental",
					instrumentalRead: {
						headline: "The texture of arriving nowhere in particular",
						compound_mood: "Ambient Drift",
						sonic_texture: "Deep Electronic",
						mood_description:
							"A slow unwinding, like watching city lights from a moving train at 3am.",
					},
				})}
			/>,
		);

		expect(
			screen.getByText("The texture of arriving nowhere in particular"),
		).toBeInTheDocument();
	});
});
