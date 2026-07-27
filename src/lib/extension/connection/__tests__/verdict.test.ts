import { describe, expect, it } from "vitest";
import type { ExtensionConnection } from "../connection-state";
import { deriveConnectionVerdict } from "../verdict";

const LINKED_ID = "linked-1";

function connection(
	overrides: Partial<ExtensionConnection>,
): ExtensionConnection {
	return {
		installed: true,
		spotifyConnected: true,
		paired: true,
		profile: { spotifyId: LINKED_ID, displayName: "fabio", avatarUrl: null },
		authFailedAt: null,
		...overrides,
	};
}

describe("deriveConnectionVerdict", () => {
	it("reports checking while the query hasn't settled", () => {
		expect(deriveConnectionVerdict(undefined, LINKED_ID)).toEqual({
			kind: "checking",
		});
	});

	it("reports extension-missing when PING never answered", () => {
		expect(
			deriveConnectionVerdict(connection({ installed: false }), LINKED_ID),
		).toEqual({ kind: "extension-missing" });
	});

	it("reports spotify-disconnected when the token is gone", () => {
		expect(
			deriveConnectionVerdict(
				connection({ spotifyConnected: false }),
				LINKED_ID,
			),
		).toEqual({ kind: "spotify-disconnected" });
	});

	it("reports spotify-disconnected when a live command failure is sticky, even if spotifyConnected still reads true", () => {
		// Invariant 7: authFailedAt outranks the poll's local-expiry check.
		expect(
			deriveConnectionVerdict(
				connection({ spotifyConnected: true, authFailedAt: Date.now() }),
				LINKED_ID,
			),
		).toEqual({ kind: "spotify-disconnected" });
	});

	it("short-circuits to ok pre-link, before the identity checks", () => {
		expect(
			deriveConnectionVerdict(
				connection({ paired: false, profile: null }),
				null,
			),
		).toEqual({ kind: "ok" });
	});

	it("still reports extension-missing pre-link when installed is false", () => {
		expect(
			deriveConnectionVerdict(connection({ installed: false }), null),
		).toEqual({ kind: "extension-missing" });
	});

	it("still reports spotify-disconnected pre-link when the token is gone", () => {
		expect(
			deriveConnectionVerdict(connection({ spotifyConnected: false }), null),
		).toEqual({ kind: "spotify-disconnected" });
	});

	it("reports mismatch when the captured profile differs from the linked account", () => {
		expect(
			deriveConnectionVerdict(
				connection({
					profile: {
						spotifyId: "other-2",
						displayName: "alex",
						avatarUrl: null,
					},
				}),
				LINKED_ID,
			),
		).toEqual({
			kind: "mismatch",
			extensionProfile: {
				spotifyId: "other-2",
				displayName: "alex",
				avatarUrl: null,
			},
		});
	});

	it("keeps mismatch outranking unpaired when both are true", () => {
		expect(
			deriveConnectionVerdict(
				connection({
					paired: false,
					profile: {
						spotifyId: "other-2",
						displayName: "alex",
						avatarUrl: null,
					},
				}),
				LINKED_ID,
			),
		).toMatchObject({ kind: "mismatch" });
	});

	it("reports unpaired for an explicit popup-side disconnect", () => {
		expect(
			deriveConnectionVerdict(
				connection({ paired: false, profile: null }),
				LINKED_ID,
			),
		).toEqual({ kind: "unpaired" });
	});

	it.each([
		["paired is null (old extension)", connection({ paired: null })],
		["profile is null (hiccup)", connection({ profile: null })],
	])("reports unverifiable, never unpaired, when %s", (_label, conn) => {
		expect(deriveConnectionVerdict(conn, LINKED_ID)).toEqual({
			kind: "unverifiable",
		});
	});

	it("reports ok when everything checks out", () => {
		expect(deriveConnectionVerdict(connection({}), LINKED_ID)).toEqual({
			kind: "ok",
		});
	});
});
