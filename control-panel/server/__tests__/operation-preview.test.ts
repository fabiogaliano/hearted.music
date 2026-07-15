import { describe, expect, it } from "vitest";
import {
	type BackstageFacts,
	backstageFingerprints,
	buildBackstagePreview,
	buildGrantSongsPreview,
	type GrantSongsFacts,
	grantSongsFingerprints,
} from "../operation-preview";

const grantFacts = (overrides: Partial<GrantSongsFacts> = {}): GrantSongsFacts => ({
	kind: "songs",
	accountId: "acct-1",
	email: "ada@example.com",
	spotifyId: "spotify-1",
	displayName: "Ada Lovelace",
	activeLikedSongs: 320,
	requestedLimit: 500,
	existingGrantExists: false,
	existingGrantAppliedAt: null,
	...overrides,
});

const backstageFacts = (overrides: Partial<BackstageFacts> = {}): BackstageFacts => ({
	kind: "backstage",
	accountId: "acct-1",
	email: "ada@example.com",
	spotifyId: "spotify-1",
	displayName: "Ada Lovelace",
	activeLikedSongs: 320,
	alreadyUnlimited: false,
	unlimitedSource: null,
	subscriptionStatus: null,
	periodEnd: "2027-07-15T00:00:00.000Z",
	...overrides,
});

describe("buildGrantSongsPreview", () => {
	it("marks a fresh grant as a change and lists the unlock + downstream rows", () => {
		const preview = buildGrantSongsPreview(grantFacts());
		expect(preview.willChange).toBe(true);
		expect(preview.targetLabel).toBe("Ada Lovelace");
		expect(preview.rows.find((r) => r.kind === "change")?.value).toMatch(
			/unlock the top 320/,
		);
		expect(preview.rows.some((r) => r.kind === "downstream")).toBe(true);
	});

	it("is a no-op when a grant was already applied", () => {
		const preview = buildGrantSongsPreview(
			grantFacts({ existingGrantExists: true, existingGrantAppliedAt: "2026-01-01T00:00:00Z" }),
		);
		expect(preview.willChange).toBe(false);
		expect(preview.rows.some((r) => r.kind === "skip")).toBe(true);
	});

	it("creates a pending grant (change) when no active liked songs and no existing grant", () => {
		const preview = buildGrantSongsPreview(
			grantFacts({ activeLikedSongs: 0 }),
		);
		expect(preview.willChange).toBe(true);
		expect(preview.rows.find((r) => r.kind === "change")?.value).toMatch(
			/pending grant/i,
		);
	});

	it("is a no-op when a pending grant already exists with no active liked songs", () => {
		const preview = buildGrantSongsPreview(
			grantFacts({ activeLikedSongs: 0, existingGrantExists: true }),
		);
		expect(preview.willChange).toBe(false);
	});
});

describe("grantSongsFingerprints", () => {
	it("changes the state fingerprint when liked count moves", () => {
		const a = grantSongsFingerprints(grantFacts());
		const b = grantSongsFingerprints(grantFacts({ activeLikedSongs: 321 }));
		expect(a.stateFingerprint).not.toBe(b.stateFingerprint);
		expect(a.inputHash).toBe(b.inputHash);
	});

	it("changes the input hash when the requested limit moves", () => {
		const a = grantSongsFingerprints(grantFacts());
		const b = grantSongsFingerprints(grantFacts({ requestedLimit: 100 }));
		expect(a.inputHash).not.toBe(b.inputHash);
	});

	it("is stable for identical facts", () => {
		expect(grantSongsFingerprints(grantFacts())).toEqual(
			grantSongsFingerprints(grantFacts()),
		);
	});
});

describe("buildBackstagePreview", () => {
	it("shows the intended gift, downstream, and manual-expiry warning", () => {
		const preview = buildBackstagePreview(backstageFacts());
		expect(preview.willChange).toBe(true);
		expect(preview.rows.some((r) => r.kind === "warning")).toBe(true);
		expect(preview.rows.find((r) => r.kind === "change")?.value).toMatch(
			/Backstage Pass/,
		);
	});

	it("is a no-op when already unlimited", () => {
		const preview = buildBackstagePreview(
			backstageFacts({ alreadyUnlimited: true, unlimitedSource: "self_hosted" }),
		);
		expect(preview.willChange).toBe(false);
		expect(preview.rows.some((r) => r.kind === "skip")).toBe(true);
	});
});

describe("backstageFingerprints", () => {
	it("excludes the wall-clock period end from the fingerprint", () => {
		const a = backstageFingerprints(backstageFacts());
		const b = backstageFingerprints(
			backstageFacts({ periodEnd: "2030-01-01T00:00:00.000Z" }),
		);
		expect(a).toEqual(b);
	});

	it("changes the state fingerprint when unlimited status flips", () => {
		const a = backstageFingerprints(backstageFacts());
		const b = backstageFingerprints(backstageFacts({ alreadyUnlimited: true }));
		expect(a.stateFingerprint).not.toBe(b.stateFingerprint);
	});
});
