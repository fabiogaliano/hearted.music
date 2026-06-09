import { describe, expect, it } from "vitest";
import {
	type OnboardingSession,
	sessionMode,
	type WalkthroughSong,
} from "@/lib/domains/library/accounts/onboarding-session";
import { resolveSession } from "../step-resolver";

const SAMPLE_SONG: WalkthroughSong = {
	id: "song-uuid",
	spotifyTrackId: "spotify:track:abc",
	slug: "artist-name",
	name: "Name",
	artist: "Artist",
	artistId: null,
	artistImageUrl: null,
	album: null,
	albumArtUrl: null,
	genres: [],
	analysis: null,
};

describe("resolveSession", () => {
	it("maps song-walkthrough to /liked-songs", () => {
		expect(
			resolveSession({ status: "song-walkthrough", song: SAMPLE_SONG }),
		).toEqual({ allowedPath: "/liked-songs" });
	});

	it("maps match-walkthrough to /match", () => {
		expect(
			resolveSession({ status: "match-walkthrough", song: SAMPLE_SONG }),
		).toEqual({ allowedPath: "/match" });
	});

	it("maps complete to /dashboard", () => {
		expect(resolveSession({ status: "complete" })).toEqual({
			allowedPath: "/dashboard",
		});
	});

	it.each<OnboardingSession["status"]>([
		"welcome",
		"pick-color",
		"install-extension",
		"syncing",
		"claim-handle",
		"flag-playlists",
		"pick-demo-song",
		"plan-selection",
	])('maps steps variant "%s" to /onboarding', (status) => {
		expect(resolveSession({ status } as OnboardingSession)).toEqual({
			allowedPath: "/onboarding",
		});
	});
});

describe("sessionMode", () => {
	it("returns 'walkthrough' for walkthrough variants", () => {
		expect(sessionMode({ status: "song-walkthrough", song: SAMPLE_SONG })).toBe(
			"walkthrough",
		);
		expect(
			sessionMode({ status: "match-walkthrough", song: SAMPLE_SONG }),
		).toBe("walkthrough");
	});

	it("returns 'complete' for the complete variant", () => {
		expect(sessionMode({ status: "complete" })).toBe("complete");
	});

	it("returns 'steps' for all other variants including claim-handle", () => {
		expect(sessionMode({ status: "welcome" })).toBe("steps");
		expect(sessionMode({ status: "pick-demo-song" })).toBe("steps");
		expect(sessionMode({ status: "claim-handle" })).toBe("steps");
	});
});
