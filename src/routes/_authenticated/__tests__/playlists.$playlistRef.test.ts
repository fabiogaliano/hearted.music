import { QueryClient } from "@tanstack/react-query";
import { isRedirect } from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildPlaylistRouteRef } from "@/features/playlists/playlistRouteRef";
import { invalidateLibrarySyncQueries, playlistKeys } from "@/lib/query-keys";
import {
	getPlaylistManagementData,
	getPlaylistTracksPage,
	PLAYLIST_NOT_FOUND_MESSAGE,
} from "@/lib/server/playlists.functions";
import { PLAYLISTS } from "@/test/fixtures";
import { Route } from "../playlists.$playlistRef";

/**
 * The loader resolves `/playlists/$playlistRef` against the playlist management
 * data before prefetching tracks. Real QueryClient; only the server fns are
 * mocked.
 */

vi.mock("@/lib/server/playlists.functions", async (importOriginal) => ({
	PLAYLIST_NOT_FOUND_MESSAGE: (
		await importOriginal<typeof import("@/lib/server/playlists.functions")>()
	).PLAYLIST_NOT_FOUND_MESSAGE,
	getPlaylistManagementData: vi.fn(),
	getPlaylistTracksPage: vi.fn(),
}));

const ACCOUNT_ID = "acct-1";
const KEPT = PLAYLISTS.lofiCityPop;
const DELETED = PLAYLISTS.likedForAnna;
const ADDED = PLAYLISTS.oldRock;

const refOf = (playlist: { id: string; name: string }) =>
	buildPlaylistRouteRef(playlist as never);
const management = (...playlists: { id: string; name: string }[]) =>
	({ playlists }) as never;

let queryClient: QueryClient;

afterEach(() => {
	vi.restoreAllMocks();
});

beforeEach(() => {
	vi.clearAllMocks();
	queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	vi.mocked(getPlaylistTracksPage).mockResolvedValue({
		tracks: [],
		nextCursor: null,
	} as never);
});

function runLoader(playlistRef: string) {
	// The route defines its loader as a plain function.
	const loader = Route.options.loader as (args: unknown) => Promise<void>;
	return loader({
		context: { queryClient, session: { accountId: ACCOUNT_ID } },
		params: { playlistRef },
	});
}

function seedManagement(...playlists: { id: string; name: string }[]) {
	queryClient.setQueryData(
		playlistKeys.management(ACCOUNT_ID),
		management(...playlists),
	);
}

async function redirectOf(promise: unknown) {
	try {
		await promise;
	} catch (error) {
		if (isRedirect(error)) return error.options;
		throw error;
	}
	return null;
}

describe("/playlists/$playlistRef loader", () => {
	it("resolves a cached ref and prefetches tracks without re-reading management data", async () => {
		seedManagement(KEPT);

		await runLoader(refOf(KEPT));

		expect(getPlaylistManagementData).not.toHaveBeenCalled();
		expect(getPlaylistTracksPage).toHaveBeenCalledWith({
			data: expect.objectContaining({ playlistId: KEPT.id }),
		});
	});

	it("re-reads management data once for a ref the cache misses (playlist added since load)", async () => {
		seedManagement(KEPT);
		vi.mocked(getPlaylistManagementData).mockResolvedValue(
			management(KEPT, ADDED),
		);

		await runLoader(refOf(ADDED));

		expect(getPlaylistManagementData).toHaveBeenCalledTimes(1);
		expect(getPlaylistTracksPage).toHaveBeenCalledWith({
			data: expect.objectContaining({ playlistId: ADDED.id }),
		});
	});

	it("redirects to /playlists when a still-cached playlist was deleted on the server", async () => {
		seedManagement(KEPT, DELETED);
		vi.mocked(getPlaylistTracksPage).mockRejectedValue(
			new Error(PLAYLIST_NOT_FOUND_MESSAGE),
		);
		vi.mocked(getPlaylistManagementData).mockResolvedValue(management(KEPT));

		expect(await redirectOf(runLoader(refOf(DELETED)))).toMatchObject({
			to: "/playlists",
			replace: true,
		});
		expect(getPlaylistManagementData).toHaveBeenCalledTimes(1);
	});

	it("re-reads management data that library sync invalidated, so a playlist the sync removed redirects even with its tracks cached", async () => {
		seedManagement(KEPT, DELETED);
		queryClient.setQueryData(playlistKeys.tracks(DELETED.id), {
			pages: [{ tracks: [], nextCursor: null }],
			pageParams: [undefined],
		});
		await invalidateLibrarySyncQueries(queryClient, ACCOUNT_ID);
		vi.mocked(getPlaylistManagementData).mockResolvedValue(management(KEPT));

		expect(await redirectOf(runLoader(refOf(DELETED)))).toMatchObject({
			to: "/playlists",
		});
		expect(getPlaylistManagementData).toHaveBeenCalledTimes(1);
		expect(getPlaylistTracksPage).not.toHaveBeenCalled();
	});

	it("redirects an unresolvable ref without reading tracks", async () => {
		seedManagement(KEPT);
		vi.mocked(getPlaylistManagementData).mockResolvedValue(management(KEPT));

		expect(await redirectOf(runLoader("not-a-valid-ref"))).toMatchObject({
			to: "/playlists",
			replace: true,
		});
		expect(getPlaylistTracksPage).not.toHaveBeenCalled();
	});

	it("reads management data once on a cold cache before redirecting an unknown ref", async () => {
		vi.mocked(getPlaylistManagementData).mockResolvedValue(management(KEPT));

		expect(await redirectOf(runLoader(refOf(ADDED)))).toMatchObject({
			to: "/playlists",
		});
		expect(getPlaylistManagementData).toHaveBeenCalledTimes(1);
	});

	it("keeps the panel open when a cached playlist's tracks read fails for another reason", async () => {
		seedManagement(KEPT);
		vi.mocked(getPlaylistTracksPage).mockRejectedValue(
			new Error("Failed to load playlist"),
		);
		vi.spyOn(console, "warn").mockImplementation(() => {});

		expect(await redirectOf(runLoader(refOf(KEPT)))).toBeNull();
		expect(getPlaylistManagementData).not.toHaveBeenCalled();
	});
});
