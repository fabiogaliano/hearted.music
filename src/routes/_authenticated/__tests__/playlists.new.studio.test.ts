import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

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
				query: (options: { queryKey: readonly unknown[] }) => Promise<unknown>;
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

// The loader reads both the gate and the preview through `query`; routing by key
// lets each test hold the two reads independently.
function fakeQueryClient(gate: Promise<unknown>, preview: Promise<unknown>) {
	const readGate = vi.fn(() => gate);
	const readPreview = vi.fn(() => preview);
	const query = (options: { queryKey: readonly unknown[] }) =>
		options.queryKey[0] === "playlist-intent-eligibility"
			? readGate()
			: readPreview();
	return { queryClient: { query }, readGate, readPreview };
}

async function loadRoute(): Promise<StudioRoute> {
	vi.resetModules();
	vi.doMock("@tanstack/react-router", () => ({
		createFileRoute: () => (routeConfig: unknown) => routeConfig,
		useLocation: vi.fn(),
	}));
	vi.doMock("@/features/playlists/create/queries", () => ({
		DEFAULT_DRAFT_CONFIG,
		intentEligibilityQueryOptions: intentEligibilityQueryOptionsMock,
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
		const { queryClient, readGate, readPreview } = fakeQueryClient(
			gate,
			preview,
		);

		await expect(
			route.loader({
				context: { queryClient },
				location: { state: {} },
			}),
		).resolves.toBeUndefined();

		expect(readGate).toHaveBeenCalledTimes(1);
		expect(readPreview).toHaveBeenCalledTimes(1);
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
		const { queryClient, readGate, readPreview } = fakeQueryClient(
			gate,
			Promise.resolve(undefined),
		);

		const loading = route.loader({
			context: { queryClient },
			location: { state: { studioSeed: { intent: "late-night focus" } } },
		});

		expect(readGate).toHaveBeenCalledTimes(1);
		expect(readPreview).not.toHaveBeenCalled();

		resolveGate({ allowed: false });
		await loading;

		expect(readPreview).toHaveBeenCalledTimes(1);
		expect(playlistDraftPreviewQueryOptionsMock).toHaveBeenCalledWith({
			...DEFAULT_DRAFT_CONFIG,
			intent: undefined,
		});
	});
});
