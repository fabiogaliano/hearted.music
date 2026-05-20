import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.fn((options: { to: string; replace?: boolean }) => ({
	kind: "redirect" as const,
	...options,
}));
const resolvePlaylistIdFromRouteRefMock = vi.fn();
const playlistManagementQueryOptionsMock = vi.fn();
const playlistTracksInfiniteQueryOptionsMock = vi.fn();

type LoaderContext = {
	session: { accountId: string };
	queryClient: {
		fetchQuery: (
			options: unknown,
		) => Promise<{ playlists: readonly unknown[] }>;
		fetchInfiniteQuery: (options: unknown) => Promise<unknown>;
	};
};

type PlaylistRoute = {
	loader: (args: {
		context: LoaderContext;
		params: { playlistRef: string };
	}) => Promise<void>;
};

function isPlaylistRoute(value: unknown): value is PlaylistRoute {
	if (typeof value !== "object" || value === null) {
		return false;
	}

	return typeof Reflect.get(value, "loader") === "function";
}

async function loadRoute(): Promise<PlaylistRoute> {
	vi.resetModules();
	vi.doMock("@tanstack/react-router", () => ({
		createFileRoute: () => (routeConfig: unknown) => routeConfig,
		redirect: redirectMock,
	}));
	vi.doMock("@/features/playlists/playlistRouteRef", () => ({
		resolvePlaylistIdFromRouteRef: resolvePlaylistIdFromRouteRefMock,
	}));
	vi.doMock("@/features/playlists/queries", () => ({
		playlistManagementQueryOptions: playlistManagementQueryOptionsMock,
		playlistTracksInfiniteQueryOptions: playlistTracksInfiniteQueryOptionsMock,
	}));

	const module = await import("../playlists.$playlistRef");
	if (!isPlaylistRoute(module.Route)) {
		throw new Error("Expected Route to expose a loader");
	}

	return module.Route;
}

describe("/_authenticated/playlists/$playlistRef route", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("fetches fresh playlist management data before resolving the route ref", async () => {
		const route = await loadRoute();
		const managementQueryFn = vi.fn();
		playlistManagementQueryOptionsMock.mockReturnValue({
			queryKey: ["playlists", "management", "acct-1"],
			queryFn: managementQueryFn,
			staleTime: 30 * 60_000,
		});
		playlistTracksInfiniteQueryOptionsMock.mockReturnValue({
			queryKey: ["playlists", "tracks", "playlist-1"],
		});
		resolvePlaylistIdFromRouteRefMock.mockReturnValue("playlist-1");

		const fetchQuery = vi.fn().mockResolvedValue({ playlists: [] });
		const fetchInfiniteQuery = vi.fn().mockResolvedValue({ pages: [] });

		await route.loader({
			context: {
				session: { accountId: "acct-1" },
				queryClient: { fetchQuery, fetchInfiniteQuery },
			},
			params: { playlistRef: "ambient-morning--cc5695a52241" },
		});

		expect(fetchQuery).toHaveBeenCalledWith({
			queryKey: ["playlists", "management", "acct-1"],
			queryFn: managementQueryFn,
			staleTime: 0,
		});
	});

	it("replaces the invalid URL when the route ref cannot be resolved", async () => {
		const route = await loadRoute();
		playlistManagementQueryOptionsMock.mockReturnValue({
			queryKey: ["playlists", "management", "acct-1"],
			queryFn: vi.fn(),
			staleTime: 30 * 60_000,
		});
		resolvePlaylistIdFromRouteRefMock.mockReturnValue(null);

		const fetchQuery = vi.fn().mockResolvedValue({ playlists: [] });
		const fetchInfiniteQuery = vi.fn().mockResolvedValue({ pages: [] });

		await expect(
			route.loader({
				context: {
					session: { accountId: "acct-1" },
					queryClient: { fetchQuery, fetchInfiniteQuery },
				},
				params: { playlistRef: "not-a-valid-ref" },
			}),
		).rejects.toEqual({
			kind: "redirect",
			to: "/playlists",
			replace: true,
		});
		expect(redirectMock).toHaveBeenCalledWith({
			to: "/playlists",
			replace: true,
		});
		expect(fetchInfiniteQuery).not.toHaveBeenCalled();
	});
});
