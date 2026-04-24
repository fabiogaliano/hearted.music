import { describe, expect, it } from "vitest";
import {
	isPathAllowed,
	resolveSession,
	sessionMode,
	type OnboardingSession,
	type WalkthroughSong,
} from "../step-resolver";

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

	it("maps complete to /liked-songs", () => {
		expect(resolveSession({ status: "complete" })).toEqual({
			allowedPath: "/liked-songs",
		});
	});

	it.each<OnboardingSession["status"]>([
		"welcome",
		"pick-color",
		"install-extension",
		"syncing",
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

	it("returns 'steps' for all other variants", () => {
		expect(sessionMode({ status: "welcome" })).toBe("steps");
		expect(sessionMode({ status: "pick-demo-song" })).toBe("steps");
	});
});

describe("isPathAllowed", () => {
	it("returns true when pathname matches allowed path", () => {
		expect(isPathAllowed("/liked-songs", "/liked-songs")).toBe(true);
	});

	it("returns false when pathname does not match allowed path", () => {
		expect(isPathAllowed("/match", "/liked-songs")).toBe(false);
	});
});
