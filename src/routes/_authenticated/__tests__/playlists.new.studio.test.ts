import { beforeEach, describe, expect, it, vi } from "vitest";

const intentEligibilityQueryOptionsMock = vi.fn(() => ({
	queryKey: ["playlist-intent-eligibility"],
}));
const playlistDraftPreviewQueryOptionsMock = vi.fn((config: unknown) => ({
	queryKey: ["playlist-draft-preview", config],
}));

const DEFAULT_DRAFT_CONFIG = {
	intent: undefined,
	genrePills: [],
	matchFilters: { version: 1 },
	maxSongs: 15,
	pinnedSongIds: [],
	excludedSongIds: [],
	suggestionsOffset: 0,
};

type StudioRoute = {
	loader: (args: {
		context: {
			queryClient: {
				ensureQueryData: (options: unknown) => Promise<unknown>;
				prefetchQuery: (options: unknown) => Promise<void>;
			};
		};
		location: {
			state: { studioSeed?: { intent?: string; genrePills?: string[] } };
		};
	}) => Promise<void>;
};

function isStudioRoute(value: unknown): value is StudioRoute {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof Reflect.get(value, "loader") === "function"
	);
}

async function loadRoute(): Promise<StudioRoute> {
	vi.resetModules();
	vi.doMock("@tanstack/react-router", () => ({
		createFileRoute: () => (routeConfig: unknown) => routeConfig,
		useLocation: vi.fn(),
	}));
	vi.doMock("@/features/playlists/create/intentEligibility", () => ({
		intentEligibilityQueryOptions: intentEligibilityQueryOptionsMock,
	}));
	vi.doMock("@/features/playlists/create/queries", () => ({
		DEFAULT_DRAFT_CONFIG,
		playlistDraftPreviewQueryOptions: playlistDraftPreviewQueryOptionsMock,
	}));
	vi.doMock("@/features/playlists/create/StudioScreen", () => ({
		StudioScreen: vi.fn(() => null),
	}));

	const module = await import("../playlists.new.studio");
	if (!isStudioRoute(module.Route)) {
		throw new Error("Expected Route to expose a loader");
	}
	return module.Route;
}

describe("/_authenticated/playlists/new/studio loader", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("starts the unseeded preview without blocking the studio shell", async () => {
		const route = await loadRoute();
		let resolveGate!: (value: { allowed: boolean }) => void;
		const gate = new Promise<{ allowed: boolean }>((resolve) => {
			resolveGate = resolve;
		});
		let resolvePreview!: () => void;
		const preview = new Promise<void>((resolve) => {
			resolvePreview = resolve;
		});
		const ensureQueryData = vi.fn(() => gate);
		const prefetchQuery = vi.fn(() => preview);

		await expect(
			route.loader({
				context: { queryClient: { ensureQueryData, prefetchQuery } },
				location: { state: {} },
			}),
		).resolves.toBeUndefined();

		expect(ensureQueryData).toHaveBeenCalledTimes(1);
		expect(prefetchQuery).toHaveBeenCalledTimes(1);
		expect(playlistDraftPreviewQueryOptionsMock).toHaveBeenCalledWith(
			DEFAULT_DRAFT_CONFIG,
		);

		resolveGate({ allowed: false });
		resolvePreview();
	});

	it("waits for eligibility before applying a seeded intent", async () => {
		const route = await loadRoute();
		let resolveGate!: (value: { allowed: boolean }) => void;
		const gate = new Promise<{ allowed: boolean }>((resolve) => {
			resolveGate = resolve;
		});
		const ensureQueryData = vi.fn(() => gate);
		const prefetchQuery = vi.fn().mockResolvedValue(undefined);

		const loading = route.loader({
			context: { queryClient: { ensureQueryData, prefetchQuery } },
			location: { state: { studioSeed: { intent: "late-night focus" } } },
		});

		expect(ensureQueryData).toHaveBeenCalledTimes(1);
		expect(prefetchQuery).not.toHaveBeenCalled();

		resolveGate({ allowed: false });
		await loading;

		expect(prefetchQuery).toHaveBeenCalledTimes(1);
		expect(playlistDraftPreviewQueryOptionsMock).toHaveBeenCalledWith({
			...DEFAULT_DRAFT_CONFIG,
			intent: undefined,
		});
	});
});
