/**
 * Adapter-wiring tests for playlist-draft.functions.ts.
 *
 * This file is a thin server-fn shell over @/lib/workflows/playlist-studio —
 * the workflow module owns all orchestration logic and has its own test
 * suites (preview.test.ts, commit.test.ts). These tests only assert the
 * adapter's job: accountId/supabase threading into the workflow calls, zod
 * validation running before the workflow is invoked, ownership filtering for
 * Studio action writes, and the one genuinely shallow handler
 * (resolveSpotifyUserId) reading auth context correctly.
 */

import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAuthContext = {
	session: { accountId: "acct-1" },
	account: { spotify_id: null as string | null },
};

vi.mock("@tanstack/react-start", () => {
	const builder = (): Record<string, unknown> => ({
		middleware: () => builder(),
		inputValidator: (validator: (data: unknown) => unknown) => ({
			handler:
				(
					fn: (args: {
						context: typeof mockAuthContext;
						data: unknown;
					}) => unknown,
				) =>
				(input?: { data?: unknown }) => {
					const validated = validator(input?.data);
					return fn({ context: mockAuthContext, data: validated });
				},
		}),
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

vi.mock("@/lib/platform/auth/auth.middleware", () => ({ authMiddleware: {} }));

const fakeSupabaseClient = { __marker: "fake-supabase" };
vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: () => fakeSupabaseClient,
}));

const selectOwnedSongIdsMock = vi.fn();
vi.mock("@/lib/domains/library/liked-songs/queries", () => ({
	selectOwnedSongIds: (...args: unknown[]) => selectOwnedSongIdsMock(...args),
}));

const insertStudioActionsMock = vi.fn();
vi.mock("@/lib/domains/taste/song-matching/studio-action-queries", () => ({
	insertStudioActions: (...args: unknown[]) => insertStudioActionsMock(...args),
}));

vi.mock("@/lib/observability/capture-server-error", () => ({
	captureServerError: vi.fn(),
}));

const runPreviewPlaylistDraftMock = vi.fn();
vi.mock("@/lib/workflows/playlist-studio/preview", () => ({
	runPreviewPlaylistDraft: (...args: unknown[]) =>
		runPreviewPlaylistDraftMock(...args),
}));

const runPersistNewPlaylistConfigMock = vi.fn();
const runRecordPlaylistMatchDecisionsMock = vi.fn();
vi.mock("@/lib/workflows/playlist-studio/publish", () => ({
	runPersistNewPlaylistConfig: (...args: unknown[]) =>
		runPersistNewPlaylistConfigMock(...args),
	runRecordPlaylistMatchDecisions: (...args: unknown[]) =>
		runRecordPlaylistMatchDecisionsMock(...args),
}));

import {
	persistNewPlaylistConfig,
	previewPlaylistDraft,
	recordPlaylistMatchDecisions,
	recordStudioActions,
	resolveSpotifyUserId,
} from "../playlist-draft.functions";

const validPreviewInput = {
	genrePills: [],
	matchFilters: { version: 1 },
	maxSongs: 15,
	pinnedSongIds: [],
	excludedSongIds: [],
};

const validPersistInput = {
	spotifyId: "abc123",
	songIds: [],
	intent: null,
	genrePills: [],
	matchFilters: { version: 1 },
	intentApplied: false,
};

const validStudioActionContext = {
	genrePills: [],
	matchFilters: { version: 1 },
	intentPresent: false,
};

describe("playlist-draft.functions adapter", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockAuthContext.session = { accountId: "acct-1" };
		mockAuthContext.account = { spotify_id: null };
		selectOwnedSongIdsMock.mockReset();
		insertStudioActionsMock.mockReset();
	});

	it("previewPlaylistDraft threads the resolved accountId and supabase client into the workflow", async () => {
		runPreviewPlaylistDraftMock.mockResolvedValue({
			preview: [],
			suggestions: [],
			totalEligible: 0,
			intentApplied: false,
		});

		await previewPlaylistDraft({ data: validPreviewInput });

		expect(runPreviewPlaylistDraftMock).toHaveBeenCalledWith(
			fakeSupabaseClient,
			"acct-1",
			expect.objectContaining({ maxSongs: 15 }),
		);
	});

	it("previewPlaylistDraft rejects invalid input before calling the workflow", async () => {
		// The mocked inputValidator (like the real one) runs synchronously inside
		// the callable, so the zod failure throws rather than rejecting — wrap in
		// an async closure so `.rejects` can observe it either way.
		await expect(async () => {
			await previewPlaylistDraft({
				data: { ...validPreviewInput, genrePills: Array(11).fill("pop") },
			});
		}).rejects.toThrow();

		expect(runPreviewPlaylistDraftMock).not.toHaveBeenCalled();
	});

	it("persistNewPlaylistConfig threads the resolved accountId and supabase client into the workflow", async () => {
		runPersistNewPlaylistConfigMock.mockResolvedValue({
			trackUris: [],
			playlistId: "playlist-1",
		});

		await persistNewPlaylistConfig({ data: validPersistInput });

		expect(runPersistNewPlaylistConfigMock).toHaveBeenCalledWith(
			fakeSupabaseClient,
			"acct-1",
			expect.objectContaining({ spotifyId: "abc123" }),
		);
	});

	it("persistNewPlaylistConfig rejects invalid input before calling the workflow", async () => {
		await expect(async () => {
			await persistNewPlaylistConfig({
				data: { ...validPersistInput, spotifyId: "not valid!" },
			});
		}).rejects.toThrow();

		expect(runPersistNewPlaylistConfigMock).not.toHaveBeenCalled();
	});

	it("recordPlaylistMatchDecisions threads the resolved accountId into the workflow", async () => {
		runRecordPlaylistMatchDecisionsMock.mockResolvedValue({ recorded: 0 });

		await recordPlaylistMatchDecisions({
			data: { spotifyId: "abc123", songIds: [] },
		});

		expect(runRecordPlaylistMatchDecisionsMock).toHaveBeenCalledWith(
			"acct-1",
			expect.objectContaining({ spotifyId: "abc123" }),
		);
	});

	it("records only Studio actions for songs owned by the account", async () => {
		const ownedSongId = "00000000-0000-4000-8000-000000000001";
		const foreignSongId = "00000000-0000-4000-8000-000000000002";
		const sessionId = "00000000-0000-4000-8000-000000000099";
		selectOwnedSongIdsMock.mockResolvedValue(Result.ok(new Set([ownedSongId])));
		insertStudioActionsMock.mockResolvedValue(Result.ok([{ id: "event-1" }]));

		const result = await recordStudioActions({
			data: {
				sessionId,
				actions: [
					{
						songId: ownedSongId,
						action: "add",
						position: 2,
						context: validStudioActionContext,
					},
					{
						songId: foreignSongId,
						action: "dismiss",
						position: 4,
						context: validStudioActionContext,
					},
				],
			},
		});

		expect(result).toEqual({ recorded: 1 });
		expect(selectOwnedSongIdsMock).toHaveBeenCalledWith("acct-1", [
			ownedSongId,
			foreignSongId,
		]);
		expect(insertStudioActionsMock).toHaveBeenCalledWith("acct-1", [
			expect.objectContaining({
				songId: ownedSongId,
				sessionId,
				action: "add",
				position: 2,
			}),
		]);
	});

	it("resolveSpotifyUserId reads spotify_id off the auth context account", async () => {
		mockAuthContext.account = { spotify_id: "spotify-user-42" };

		const result = await resolveSpotifyUserId();

		expect(result).toEqual({ spotifyUserId: "spotify-user-42" });
	});

	it("resolveSpotifyUserId returns null when the account has never synced", async () => {
		mockAuthContext.account = { spotify_id: null };

		const result = await resolveSpotifyUserId();

		expect(result).toEqual({ spotifyUserId: null });
	});
});
