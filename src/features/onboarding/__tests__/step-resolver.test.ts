import { describe, expect, it } from "vitest";
import {
	type OnboardingSession,
	sessionMode,
	type WalkthroughSong,
} from "@/lib/domains/library/accounts/onboarding-session";
import { isPathAllowed, resolveSession } from "../step-resolver";

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

	it("maps flag-playlists to /playlists", () => {
		expect(resolveSession({ status: "flag-playlists" })).toEqual({
			allowedPath: "/playlists",
		});
	});

	it("maps complete to /playlists", () => {
		expect(resolveSession({ status: "complete" })).toEqual({
			allowedPath: "/playlists",
		});
	});

	it.each<OnboardingSession["status"]>([
		"welcome",
		"pick-color",
		"install-extension",
		"syncing",
		"claim-handle",
		"pick-demo-song",
		"plan-selection",
	])('maps steps variant "%s" to /onboarding', (status) => {
		expect(resolveSession({ status } as OnboardingSession)).toEqual({
			allowedPath: "/onboarding",
		});
	});
});

describe("isPathAllowed", () => {
	it("allows an exact path match", () => {
		expect(isPathAllowed("/playlists", "/playlists")).toBe(true);
	});

	it("allows child routes of the preview path", () => {
		expect(isPathAllowed("/playlists/some-ref", "/playlists")).toBe(true);
	});

	it("rejects an unrelated path", () => {
		expect(isPathAllowed("/dashboard", "/playlists")).toBe(false);
	});

	it("rejects a path that only shares a prefix without a separator", () => {
		expect(isPathAllowed("/playlists-archive", "/playlists")).toBe(false);
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

	it("returns 'playlist-preview' for flag-playlists", () => {
		expect(sessionMode({ status: "flag-playlists" })).toBe("playlist-preview");
	});

	it("returns 'steps' for all other variants including claim-handle", () => {
		expect(sessionMode({ status: "welcome" })).toBe("steps");
		expect(sessionMode({ status: "pick-demo-song" })).toBe("steps");
		expect(sessionMode({ status: "claim-handle" })).toBe("steps");
	});
});
