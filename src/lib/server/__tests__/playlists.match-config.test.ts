import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Playlist } from "@/lib/domains/library/playlists/queries";
import { DatabaseError } from "@/lib/shared/errors/database";
import { PlaylistManagementChanges } from "@/lib/workflows/library-processing/changes";
import type { LibraryProcessingApplyOutcome } from "@/lib/workflows/library-processing/types";
import {
	savePlaylistMatchConfig,
	savePlaylistMatchIntent,
} from "../playlists.functions";

const {
	mockAuthContext,
	mockGetPlaylistById,
	mockUpdatePlaylistMatchConfig,
	mockUpdatePlaylistMatchIntent,
	mockApplyLibraryProcessingChange,
	mockEnqueueDeckJob,
	mockGetLatestMatchSnapshot,
	mockCaptureWithWaitUntil,
	mockCaptureServerError,
	mockResolveVisibilityConfigHash,
} = vi.hoisted(() => ({
	mockAuthContext: {
		session: { accountId: "acct-1" },
		account: null,
	},
	mockGetPlaylistById: vi.fn(),
	mockUpdatePlaylistMatchConfig: vi.fn(),
	mockUpdatePlaylistMatchIntent: vi.fn(),
	mockApplyLibraryProcessingChange: vi.fn(),
	mockEnqueueDeckJob: vi.fn(),
	mockGetLatestMatchSnapshot: vi.fn(),
	mockCaptureWithWaitUntil: vi.fn().mockResolvedValue(undefined),
	mockCaptureServerError: vi.fn(),
	mockResolveVisibilityConfigHash: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => {
	const builder = (): Record<string, unknown> => ({
		middleware: () => builder(),
		inputValidator: () => builder(),
		handler:
			(
				fn: (args: {
					context: typeof mockAuthContext;
					data: unknown;
				}) => unknown,
			) =>
			(input?: { data?: unknown }) =>
				fn({ context: mockAuthContext, data: input?.data }),
	});
	return {
		createServerFn: builder,
		createMiddleware: () => ({
			server: () => ({}),
			type: () => ({ server: () => ({}) }),
		}),
	};
});

vi.mock("@/lib/domains/library/playlists/queries", () => ({
	upsertPlaylists: vi.fn(),
	getPlaylists: vi.fn().mockResolvedValue({ ok: true, value: [] }),
	getTargetPlaylists: vi.fn().mockResolvedValue({ ok: true, value: [] }),
	getPlaylistById: (...args: unknown[]) => mockGetPlaylistById(...args),
	getPlaylistBySpotifyId: vi.fn(),
	getPlaylistSongsPage: vi.fn(),
	deletePlaylist: vi.fn(),
	setPlaylistTarget: vi.fn(),
	updatePlaylistMetadata: vi.fn(),
	updatePlaylistGenrePills: vi.fn(),
	updatePlaylistMatchIntent: (...args: unknown[]) =>
		mockUpdatePlaylistMatchIntent(...args),
	updatePlaylistMatchConfig: (...args: unknown[]) =>
		mockUpdatePlaylistMatchConfig(...args),
}));

vi.mock("@/utils/posthog-server", () => ({
	captureWithWaitUntil: (...args: unknown[]) =>
		mockCaptureWithWaitUntil(...args),
}));

vi.mock("@/lib/observability/capture-server-error", () => ({
	captureServerError: (...args: unknown[]) => mockCaptureServerError(...args),
}));

vi.mock("@/lib/domains/library/songs/queries", () => ({
	getByIds: vi.fn().mockResolvedValue({ ok: true, value: [] }),
}));

vi.mock("@/lib/workflows/library-processing/service", () => ({
	applyLibraryProcessingChange: (...args: unknown[]) =>
		mockApplyLibraryProcessingChange(...args),
}));

vi.mock("@/lib/domains/taste/match-review-queue/deck-jobs", () => ({
	enqueueDeckJob: (...args: unknown[]) => mockEnqueueDeckJob(...args),
}));

vi.mock("@/lib/domains/taste/song-matching/queries", () => ({
	getLatestMatchSnapshot: (...args: unknown[]) =>
		mockGetLatestMatchSnapshot(...args),
}));

vi.mock(
	"@/lib/domains/taste/match-review-queue/visibility-config-hash",
	() => ({
		resolveVisibilityConfigHash: (...args: unknown[]) =>
			mockResolveVisibilityConfigHash(...args),
	}),
);

// parseSaveMatchFilters uses isLanguageCatalogCode; we do NOT mock schemas.ts
// so the strict validator runs against real catalog logic. Language tests only
// use known-good codes ("en") or omit the languages field entirely.

function makePlaylist(overrides: Partial<Playlist> = {}): Playlist {
	return {
		id: "uuid-1",
		account_id: "acct-1",
		spotify_id: "abc123",
		name: "Test Playlist",
		description: null,
		match_intent: null,
		match_filters: { version: 1 },
		snapshot_id: null,
		is_public: true,
		song_count: 0,
		is_target: true,
		image_url: null,
		genre_pills: [],
		created_at: "2026-03-28T00:00:00Z",
		updated_at: "2026-03-28T00:00:00Z",
		...overrides,
	};
}

function makeApplyOutcome(): LibraryProcessingApplyOutcome {
	return {
		accountId: "acct-1",
		changeKind: "playlist_management_session_flushed",
		state: {
			accountId: "acct-1",
			enrichment: { requestedAt: null, settledAt: null, activeJobId: null },
			matchSnapshotRefresh: {
				requestedAt: null,
				settledAt: null,
				activeJobId: null,
			},
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
		},
		effects: [],
		effectResults: [],
	};
}

const BASE_INPUT = {
	playlistId: "uuid-1",
	matchIntent: "chill evening vibes",
	genrePills: ["rock"],
	matchFilters: { version: 1 as const },
};

describe("savePlaylistMatchConfig", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetPlaylistById.mockResolvedValue(
			Result.ok(makePlaylist({ account_id: "acct-1" })),
		);
		mockUpdatePlaylistMatchConfig.mockResolvedValue(Result.ok(makePlaylist()));
		mockApplyLibraryProcessingChange.mockResolvedValue(
			Result.ok(makeApplyOutcome()),
		);
		mockGetLatestMatchSnapshot.mockResolvedValue(Result.ok({ id: "snap-1" }));
		mockEnqueueDeckJob.mockResolvedValue(Result.ok(null));
		mockResolveVisibilityConfigHash.mockImplementation(
			(_accountId: string, orientation: string) =>
				Promise.resolve(
					Result.ok({
						hash: `vc_test_${orientation}`,
						minScore: 0.5,
						policy: {},
					}),
				),
		);
	});

	// ── Ownership ────────────────────────────────────────────────────────────

	it("throws 'Failed to load playlist' when the playlist lookup errors", async () => {
		// A DB error is surfaced distinctly from a missing/other-account playlist so
		// the failure isn't silently masked as "not found" (matches getPlaylistTracksPage).
		mockGetPlaylistById.mockResolvedValue(
			Result.err(new DatabaseError({ code: "42000", message: "db error" })),
		);

		await expect(savePlaylistMatchConfig({ data: BASE_INPUT })).rejects.toThrow(
			"Failed to load playlist",
		);

		expect(mockUpdatePlaylistMatchConfig).not.toHaveBeenCalled();
	});

	it("throws 'Playlist not found' when playlist is missing", async () => {
		mockGetPlaylistById.mockResolvedValue(Result.ok(null));

		await expect(savePlaylistMatchConfig({ data: BASE_INPUT })).rejects.toThrow(
			"Playlist not found",
		);

		expect(mockUpdatePlaylistMatchConfig).not.toHaveBeenCalled();
	});

	it("throws 'Playlist not found' when playlist belongs to another account", async () => {
		mockGetPlaylistById.mockResolvedValue(
			Result.ok(makePlaylist({ account_id: "acct-other" })),
		);

		await expect(savePlaylistMatchConfig({ data: BASE_INPUT })).rejects.toThrow(
			"Playlist not found",
		);

		expect(mockUpdatePlaylistMatchConfig).not.toHaveBeenCalled();
	});

	// ── matchIntent normalization ─────────────────────────────────────────────

	it("trims leading and trailing whitespace from matchIntent", async () => {
		await savePlaylistMatchConfig({
			data: { ...BASE_INPUT, matchIntent: "  chill vibes  " },
		});

		expect(mockUpdatePlaylistMatchConfig).toHaveBeenCalledWith(
			"acct-1",
			"uuid-1",
			expect.objectContaining({ matchIntent: "chill vibes" }),
		);
	});

	it("preserves internal whitespace and newlines in matchIntent exactly", async () => {
		const intentWithInternalWs = "line one\n  line two\n\nline three";
		await savePlaylistMatchConfig({
			data: { ...BASE_INPUT, matchIntent: intentWithInternalWs },
		});

		expect(mockUpdatePlaylistMatchConfig).toHaveBeenCalledWith(
			"acct-1",
			"uuid-1",
			expect.objectContaining({ matchIntent: intentWithInternalWs }),
		);
	});

	it("converts empty string matchIntent to null", async () => {
		await savePlaylistMatchConfig({
			data: { ...BASE_INPUT, matchIntent: "" },
		});

		expect(mockUpdatePlaylistMatchConfig).toHaveBeenCalledWith(
			"acct-1",
			"uuid-1",
			expect.objectContaining({ matchIntent: null }),
		);
	});

	it("converts whitespace-only matchIntent to null", async () => {
		await savePlaylistMatchConfig({
			data: { ...BASE_INPUT, matchIntent: "   \n  " },
		});

		expect(mockUpdatePlaylistMatchConfig).toHaveBeenCalledWith(
			"acct-1",
			"uuid-1",
			expect.objectContaining({ matchIntent: null }),
		);
	});

	it("passes null matchIntent through as null", async () => {
		await savePlaylistMatchConfig({
			data: { ...BASE_INPUT, matchIntent: null },
		});

		expect(mockUpdatePlaylistMatchConfig).toHaveBeenCalledWith(
			"acct-1",
			"uuid-1",
			expect.objectContaining({ matchIntent: null }),
		);
	});

	// ── genrePills sanitization ────────────────────────────────────────────────

	it("sanitizes genrePills: canonicalizes variant spellings and drops non-whitelist entries", async () => {
		// "hip hop" → "hip-hop"; "happy" is not in whitelist
		await savePlaylistMatchConfig({
			data: { ...BASE_INPUT, genrePills: ["hip hop", "happy", "rock"] },
		});

		expect(mockUpdatePlaylistMatchConfig).toHaveBeenCalledWith(
			"acct-1",
			"uuid-1",
			expect.objectContaining({ genrePills: ["hip-hop", "rock"] }),
		);
	});

	it("caps sanitized genrePills at 5", async () => {
		const sixValid = ["rock", "pop", "jazz", "metal", "folk", "electronic"];
		await savePlaylistMatchConfig({
			data: { ...BASE_INPUT, genrePills: sixValid },
		});

		const callArg = mockUpdatePlaylistMatchConfig.mock.calls[0][2] as {
			genrePills: string[];
		};
		expect(callArg.genrePills).toHaveLength(5);
	});

	// ── matchFilters strict validation ────────────────────────────────────────

	it("throws and writes nothing when matchFilters contains unknown keys", async () => {
		await expect(
			savePlaylistMatchConfig({
				data: {
					...BASE_INPUT,
					matchFilters: { version: 1, unknownKey: "oops" } as never,
				},
			}),
		).rejects.toThrow("Invalid match filters");

		expect(mockUpdatePlaylistMatchConfig).not.toHaveBeenCalled();
	});

	it("throws and writes nothing when matchFilters has an invalid known field", async () => {
		await expect(
			savePlaylistMatchConfig({
				data: {
					...BASE_INPUT,
					// releaseYear with an unsupported kind — should fail strict parse
					matchFilters: { version: 1, vocalGender: "unknown" } as never,
				},
			}),
		).rejects.toThrow("Invalid match filters");

		expect(mockUpdatePlaylistMatchConfig).not.toHaveBeenCalled();
	});

	it("accepts a valid matchFilters object with active fields", async () => {
		const filters = {
			version: 1 as const,
			vocalGender: "female" as const,
			releaseYear: { kind: "after" as const, start: 2000 },
		};

		await savePlaylistMatchConfig({
			data: { ...BASE_INPUT, matchFilters: filters },
		});

		expect(mockUpdatePlaylistMatchConfig).toHaveBeenCalledWith(
			"acct-1",
			"uuid-1",
			expect.objectContaining({ matchFilters: filters }),
		);
	});

	// ── All-or-nothing write ──────────────────────────────────────────────────

	it("does not write any field when matchFilters validation fails", async () => {
		await expect(
			savePlaylistMatchConfig({
				data: {
					...BASE_INPUT,
					matchFilters: { version: 1, badField: true } as never,
				},
			}),
		).rejects.toThrow();

		expect(mockUpdatePlaylistMatchConfig).not.toHaveBeenCalled();
		expect(mockApplyLibraryProcessingChange).not.toHaveBeenCalled();
	});

	it("throws when the DB write fails, not calling invalidation", async () => {
		mockUpdatePlaylistMatchConfig.mockResolvedValue(
			Result.err(new DatabaseError({ code: "42000", message: "write error" })),
		);

		await expect(savePlaylistMatchConfig({ data: BASE_INPUT })).rejects.toThrow(
			"Failed to save match config",
		);

		expect(mockApplyLibraryProcessingChange).not.toHaveBeenCalled();
	});

	// ── Change-fact classification ────────────────────────────────────────────

	it("emits scoringConfigChanged when intent or genre pills differ from stored values", async () => {
		// BASE_INPUT has matchIntent="chill evening vibes" and genrePills=["rock"].
		// makePlaylist() defaults have match_intent=null and genre_pills=[].
		// Both differ → scoringConfigChanged must be true.
		await savePlaylistMatchConfig({ data: BASE_INPUT });

		expect(mockApplyLibraryProcessingChange).toHaveBeenCalledWith(
			PlaylistManagementChanges.sessionFlushed({
				accountId: "acct-1",
				targetMembershipChanged: false,
				scoringConfigChanged: true,
				readTimeFilterChanged: expect.any(Boolean),
			}),
		);
		expect(mockEnqueueDeckJob).not.toHaveBeenCalled();
	});

	it("takes filter-only path when only match_filters changed", async () => {
		// Existing playlist has the same intent and genre pills as BASE_INPUT
		// but a different filter — only readTimeFilterChanged should fire.
		mockGetPlaylistById.mockResolvedValue(
			Result.ok(
				makePlaylist({
					account_id: "acct-1",
					match_intent: "chill evening vibes",
					genre_pills: ["rock"],
					match_filters: { version: 1 },
				}),
			),
		);

		await savePlaylistMatchConfig({
			data: {
				...BASE_INPUT,
				matchFilters: { version: 1 as const, vocalGender: "female" as const },
			},
		});

		// Filter-only: no applyLibraryProcessingChange. A read-time filter change
		// enqueues a build_proposals deck job for BOTH orientations against the
		// account's latest snapshot; the worker rebuilds proposals and appends
		// sessions so an active deck reflects the new filters on its next read (MSR-37).
		expect(mockApplyLibraryProcessingChange).not.toHaveBeenCalled();
		expect(mockGetLatestMatchSnapshot).toHaveBeenCalledWith("acct-1");
		expect(mockEnqueueDeckJob).toHaveBeenCalledTimes(2);
		expect(mockEnqueueDeckJob).toHaveBeenCalledWith({
			accountId: "acct-1",
			orientation: "song",
			kind: "build_proposals",
			idempotencyKey: "build:acct-1:song:snap-1:vc_test_song",
			payload: { snapshotId: "snap-1" },
		});
		expect(mockEnqueueDeckJob).toHaveBeenCalledWith({
			accountId: "acct-1",
			orientation: "playlist",
			kind: "build_proposals",
			idempotencyKey: "build:acct-1:playlist:snap-1:vc_test_playlist",
			payload: { snapshotId: "snap-1" },
		});
	});

	it("skips the enqueue for an orientation whose hash resolution fails, still enqueues the other, and still succeeds (M1/P3.4)", async () => {
		// Same filter-only setup as "takes filter-only path when only match_filters changed".
		mockGetPlaylistById.mockResolvedValue(
			Result.ok(
				makePlaylist({
					account_id: "acct-1",
					match_intent: "chill evening vibes",
					genre_pills: ["rock"],
					match_filters: { version: 1 },
				}),
			),
		);
		const hashError = new DatabaseError({
			code: "42000",
			message: "hash resolution failed",
		});
		mockResolveVisibilityConfigHash.mockImplementation(
			(_accountId: string, orientation: string) => {
				if (orientation === "song") {
					return Promise.resolve(Result.err(hashError));
				}
				return Promise.resolve(
					Result.ok({
						hash: `vc_test_${orientation}`,
						minScore: 0.5,
						policy: {},
					}),
				);
			},
		);

		const result = await savePlaylistMatchConfig({
			data: {
				...BASE_INPUT,
				matchFilters: { version: 1 as const, vocalGender: "female" as const },
			},
		});

		// The failed orientation must never enqueue a hash-less (pre-M1) key — it
		// is skipped entirely rather than degrading to the old dedupe-prone key.
		expect(mockEnqueueDeckJob).not.toHaveBeenCalledWith(
			expect.objectContaining({ orientation: "song" }),
		);
		expect(mockEnqueueDeckJob).toHaveBeenCalledTimes(1);
		expect(mockEnqueueDeckJob).toHaveBeenCalledWith({
			accountId: "acct-1",
			orientation: "playlist",
			kind: "build_proposals",
			idempotencyKey: "build:acct-1:playlist:snap-1:vc_test_playlist",
			payload: { snapshotId: "snap-1" },
		});
		// The already-saved config must not be rolled back or thrown away over a
		// best-effort rebuild-enqueue failure.
		expect(result).toEqual({
			matchIntent: "chill evening vibes",
			genrePills: ["rock"],
			matchFilters: { version: 1, vocalGender: "female" },
		});
		// DatabaseError implements Symbol.iterator (Result.gen yieldability), which
		// trips up toHaveBeenCalledWith's deep-equality iteration protocol — assert
		// identity + shape separately instead (mirrors the existing enqueue-failure
		// test above, which uses the same `.toBe()` pattern for the same reason).
		const [capturedError, context] = mockCaptureServerError.mock.calls[0] ?? [];
		expect(capturedError).toBe(hashError);
		expect(context).toMatchObject({
			area: "playlists",
			operation: "save_playlist_match_config",
			accountId: "acct-1",
			extra: {
				stage: "post_save_invalidation",
				step: "resolve_visibility_config_hash",
				orientation: "song",
			},
		});
	});

	it("still succeeds and captures the error when a filter-path enqueue fails", async () => {
		// Same scoring signals as BASE_INPUT but a different filter → filter-only
		// path, which enqueues build_proposals jobs for both orientations.
		mockGetPlaylistById.mockResolvedValue(
			Result.ok(
				makePlaylist({
					account_id: "acct-1",
					match_intent: "chill evening vibes",
					genre_pills: ["rock"],
					match_filters: { version: 1 },
				}),
			),
		);
		// Enqueue fails for both orientations. Best-effort: the filters are already
		// committed, so the handler must NOT roll back the save — it returns the
		// normalized result and only reports the enqueue error to Sentry.
		const enqueueError = new DatabaseError({
			code: "42000",
			message: "enqueue error",
		});
		mockEnqueueDeckJob.mockResolvedValue(Result.err(enqueueError));

		const result = await savePlaylistMatchConfig({
			data: {
				...BASE_INPUT,
				matchFilters: { version: 1 as const, vocalGender: "female" as const },
			},
		});

		// The save's success result is unaffected by the enqueue failure.
		expect(result).toEqual({
			matchIntent: "chill evening vibes",
			genrePills: ["rock"],
			matchFilters: { version: 1, vocalGender: "female" },
		});

		// One capture per failed orientation (song + playlist).
		expect(mockCaptureServerError).toHaveBeenCalledTimes(2);
		const [capturedError, context] = mockCaptureServerError.mock.calls[0] ?? [];
		expect(capturedError).toBe(enqueueError);
		expect(context).toMatchObject({
			area: "playlists",
			operation: "save_playlist_match_config",
			accountId: "acct-1",
			extra: { stage: "post_save_invalidation", snapshotId: "snap-1" },
		});
	});

	it("takes scoring path when intent changed even if filters are the same", async () => {
		mockGetPlaylistById.mockResolvedValue(
			Result.ok(
				makePlaylist({
					account_id: "acct-1",
					match_intent: "old intent",
					genre_pills: ["rock"],
					match_filters: { version: 1 },
				}),
			),
		);

		await savePlaylistMatchConfig({
			data: {
				...BASE_INPUT,
				matchIntent: "new intent",
				matchFilters: { version: 1 as const },
			},
		});

		expect(mockApplyLibraryProcessingChange).toHaveBeenCalledTimes(1);
		expect(mockEnqueueDeckJob).not.toHaveBeenCalled();
	});

	it("skips all invalidation when nothing actually changed (idempotent save)", async () => {
		// Existing playlist already has the same values as the input.
		mockGetPlaylistById.mockResolvedValue(
			Result.ok(
				makePlaylist({
					account_id: "acct-1",
					match_intent: "chill evening vibes",
					genre_pills: ["rock"],
					match_filters: { version: 1 },
				}),
			),
		);

		await savePlaylistMatchConfig({ data: BASE_INPUT });

		expect(mockApplyLibraryProcessingChange).not.toHaveBeenCalled();
		expect(mockEnqueueDeckJob).not.toHaveBeenCalled();
	});

	// ── Non-fatal invalidation failure ─────────────────────────────────────────

	it("returns normalized values even when invalidation fails after write", async () => {
		mockApplyLibraryProcessingChange.mockResolvedValue(
			Result.err({
				kind: "load_state",
				cause: new DatabaseError({ code: "42000", message: "state error" }),
			}),
		);
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const result = await savePlaylistMatchConfig({
			data: {
				...BASE_INPUT,
				matchIntent: "  chill  ",
				genrePills: ["rock"],
				matchFilters: { version: 1 as const },
			},
		});

		// Write succeeded and normalized values are returned
		expect(result.matchIntent).toBe("chill");
		expect(result.genrePills).toEqual(["rock"]);
		expect(result.matchFilters).toEqual({ version: 1 });

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining(
				"match config saved but snapshot invalidation failed",
			),
			expect.anything(),
		);
		errorSpy.mockRestore();
	});

	// ── Return shape ──────────────────────────────────────────────────────────

	it("returns normalized matchIntent, sanitized genrePills, and parsed matchFilters", async () => {
		const result = await savePlaylistMatchConfig({
			data: {
				...BASE_INPUT,
				matchIntent: "  evening  ",
				genrePills: ["hip hop", "rock"],
				matchFilters: { version: 1 as const, vocalGender: "male" as const },
			},
		});

		expect(result).toEqual({
			matchIntent: "evening",
			genrePills: ["hip-hop", "rock"],
			matchFilters: { version: 1, vocalGender: "male" },
		});
	});

	it("writes all three fields together in a single updatePlaylistMatchConfig call", async () => {
		await savePlaylistMatchConfig({
			data: {
				...BASE_INPUT,
				matchIntent: "focused work",
				genrePills: ["jazz"],
				matchFilters: { version: 1 as const },
			},
		});

		// Must be called exactly once, not separate calls for each field
		expect(mockUpdatePlaylistMatchConfig).toHaveBeenCalledTimes(1);
		expect(mockUpdatePlaylistMatchConfig).toHaveBeenCalledWith(
			"acct-1",
			"uuid-1",
			{
				matchIntent: "focused work",
				genrePills: ["jazz"],
				matchFilters: { version: 1 },
			},
		);
	});
});

describe("savePlaylistMatchIntent", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetPlaylistById.mockResolvedValue(
			Result.ok(makePlaylist({ account_id: "acct-1" })),
		);
		mockUpdatePlaylistMatchIntent.mockResolvedValue(Result.ok(makePlaylist()));
		mockApplyLibraryProcessingChange.mockResolvedValue(
			Result.ok(makeApplyOutcome()),
		);
	});

	it("emits match_intent_set with presence + length but never the intent text", async () => {
		await savePlaylistMatchIntent({
			data: { playlistId: "uuid-1", matchIntent: "  chill evening vibes  " },
		});

		// Trimmed before write — length reflects the trimmed value, and the raw
		// text is deliberately absent from the analytics payload (privacy).
		expect(mockCaptureWithWaitUntil).toHaveBeenCalledWith({
			distinctId: "acct-1",
			event: "match_intent_set",
			properties: {
				playlist_id: "uuid-1",
				has_intent: true,
				intent_length: "chill evening vibes".length,
			},
		});
	});

	it("reports has_intent=false when the intent is cleared", async () => {
		await savePlaylistMatchIntent({
			data: { playlistId: "uuid-1", matchIntent: "   " },
		});

		expect(mockCaptureWithWaitUntil).toHaveBeenCalledWith({
			distinctId: "acct-1",
			event: "match_intent_set",
			properties: {
				playlist_id: "uuid-1",
				has_intent: false,
				intent_length: 0,
			},
		});
	});

	it("does not emit when the ownership check fails", async () => {
		mockGetPlaylistById.mockResolvedValue(
			Result.err(new DatabaseError({ code: "08006", message: "db down" })),
		);

		await expect(
			savePlaylistMatchIntent({
				data: { playlistId: "uuid-1", matchIntent: "x" },
			}),
		).rejects.toThrow(/playlist not found/i);
		expect(mockCaptureWithWaitUntil).not.toHaveBeenCalled();
	});

	it("swallows a capture failure, still saves, and reports it to Sentry", async () => {
		const captureError = new Error("posthog unavailable");
		mockCaptureWithWaitUntil.mockRejectedValue(captureError);

		const result = await savePlaylistMatchIntent({
			data: { playlistId: "uuid-1", matchIntent: "vibes" },
		});

		// The intent is already written — a best-effort analytics failure must not
		// turn the successful save into a thrown error.
		expect(result).toEqual({ success: true, matchIntent: "vibes" });
		await vi.waitFor(() =>
			expect(mockCaptureServerError).toHaveBeenCalledTimes(1),
		);
		const [capturedError, context] = mockCaptureServerError.mock.calls[0] ?? [];
		expect(capturedError).toBe(captureError);
		expect(context).toMatchObject({
			area: "analytics",
			operation: "capture_match_intent_set",
			accountId: "acct-1",
			extra: { event: "match_intent_set" },
		});
	});
});
