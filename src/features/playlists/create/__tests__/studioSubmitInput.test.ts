import { describe, expect, it } from "vitest";
import { buildStudioSubmitInput } from "../studioSubmitInput";

const matchFilters = {
	version: 1 as const,
	releaseYear: { kind: "after" as const, start: 1990 },
};

describe("buildStudioSubmitInput", () => {
	it("uses the committed config and preserves tracklist order", () => {
		expect(
			buildStudioSubmitInput("  Night Mix  ", {
				tracklist: [{ id: "song-2" }, { id: "song-1" }],
				committedConfig: {
					genrePills: ["indie"],
					matchFilters,
					intent: "late-night drive",
				},
				intentApplied: true,
			}),
		).toEqual({
			name: "Night Mix",
			songIds: ["song-2", "song-1"],
			genrePills: ["indie"],
			matchFilters,
			intentApplied: true,
			intent: "late-night drive",
		});
	});

	it("does not publish intent when the preview did not apply it", () => {
		const input = buildStudioSubmitInput("Mix", {
			tracklist: [{ id: "song-1" }],
			committedConfig: {
				genrePills: [],
				matchFilters: { version: 1 },
				intent: "ignored intent",
			},
			intentApplied: false,
		});

		expect(input.intent).toBeNull();
	});
});
