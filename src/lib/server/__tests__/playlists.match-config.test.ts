import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Playlist } from "@/lib/domains/library/playlists/queries";
import { DatabaseError } from "@/lib/shared/errors/database";
import { PlaylistManagementChanges } from "@/lib/workflows/library-processing/changes/playlist-management";
import type { LibraryProcessingApplyOutcome } from "@/lib/workflows/library-processing/types";
import { savePlaylistMatchConfig } from "../playlists.functions";

const {
	mockAuthContext,
	mockGetPlaylistById,
	mockUpdatePlaylistMatchConfig,
	mockApplyLibraryProcessingChange,
} = vi.hoisted(() => ({
	mockAuthContext: {
		session: { accountId: "acct-1" },
		account: null,
	},
	mockGetPlaylistById: vi.fn(),
	mockUpdatePlaylistMatchConfig: vi.fn(),
	mockApplyLibraryProcessingChange: vi.fn(),
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
	updatePlaylistMatchIntent: vi.fn(),
	updatePlaylistMatchConfig: (...args: unknown[]) =>
		mockUpdatePlaylistMatchConfig(...args),
}));

vi.mock("@/lib/domains/library/songs/queries", () => ({
	getByIds: vi.fn().mockResolvedValue({ ok: true, value: [] }),
}));

vi.mock("@/lib/workflows/library-processing/service", () => ({
	applyLibraryProcessingChange: (...args: unknown[]) =>
		mockApplyLibraryProcessingChange(...args),
}));

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

	// ── Metadata invalidation ──────────────────────────────────────────────────

	it("emits metadata-changed invalidation after a successful write", async () => {
		await savePlaylistMatchConfig({ data: BASE_INPUT });

		expect(mockApplyLibraryProcessingChange).toHaveBeenCalledWith(
			PlaylistManagementChanges.sessionFlushed({
				accountId: "acct-1",
				targetMembershipChanged: false,
				targetMetadataChanged: true,
			}),
		);
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
