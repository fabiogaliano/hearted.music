import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { computePreviewFingerprint } from "@/lib/workflows/walkthrough-match-preview/queries";
import { getDemoSongMatches } from "../onboarding.functions";

const {
	mockAuthContext,
	mockGetOrCreatePreferences,
	mockGetPlaylists,
	mockReadBillingState,
	mockCreateAdminSupabaseClient,
	mockGetDemoMatches,
	mockEnsurePreview,
	mockGetWalkthroughPreview,
} = vi.hoisted(() => ({
	mockAuthContext: {
		session: { accountId: "acct-1" },
		account: null,
	},
	mockGetOrCreatePreferences: vi.fn(),
	mockGetPlaylists: vi.fn(),
	mockReadBillingState: vi.fn(),
	mockCreateAdminSupabaseClient: vi.fn(),
	mockGetDemoMatches: vi.fn(),
	mockEnsurePreview: vi.fn().mockResolvedValue({ status: "ensured" }),
	mockGetWalkthroughPreview: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => {
	const builder = (): Record<string, unknown> => ({
		middleware: () => builder(),
		inputValidator: () => builder(),
		handler: (fn: (args: unknown) => unknown) => () =>
			fn({ context: mockAuthContext }),
	});
	return {
		createServerFn: builder,
		createMiddleware: () => ({
			server: () => ({}),
			type: () => ({ server: () => ({}) }),
		}),
	};
});

vi.mock("@/lib/platform/auth/auth.middleware", () => ({
	authMiddleware: {},
}));

vi.mock("@/lib/domains/library/accounts/preferences-queries", () => ({
	getOrCreatePreferences: (id: string) => mockGetOrCreatePreferences(id),
	completeOnboarding: vi.fn(),
	isOnboardingComplete: vi.fn(),
	ONBOARDING_STEPS: { safeParse: vi.fn() },
	updateOnboardingStep: vi.fn(),
	updateTheme: vi.fn(),
	clearPhaseJobIds: vi.fn(),
}));

vi.mock("@/lib/domains/library/playlists/queries", () => ({
	getPlaylists: (id: string) => mockGetPlaylists(id),
	getPlaylistCount: vi.fn(),
	getPlaylistSongCount: vi.fn(),
	setPlaylistTargets: vi.fn(),
}));

vi.mock("@/lib/domains/library/artists/queries", () => ({
	getLibraryArtistCount: vi.fn(),
}));

vi.mock("@/lib/domains/billing/queries", () => ({
	readBillingState: (...args: unknown[]) =>
		mockReadBillingState(args[0], args[1]),
}));
vi.mock("@/lib/domains/billing/state", () => ({
	hasUnlimitedAccess: () => false,
}));
vi.mock("@/lib/domains/billing/unlocks", () => ({
	grantFreeAllocation: vi.fn(),
}));
vi.mock("@/lib/domains/library/liked-songs/queries", () => ({
	getCount: vi.fn(),
}));

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: () => mockCreateAdminSupabaseClient(),
}));

vi.mock("@/lib/content/landing/demo-matches", () => ({
	getDemoMatchesForSong: (id: string) => mockGetDemoMatches(id),
}));

vi.mock("@/lib/content/landing/landing-songs.server", () => ({
	getLandingSongsManifest: () => [],
}));

vi.mock("@/lib/workflows/library-processing/service", () => ({
	applyLibraryProcessingChange: vi.fn(),
}));
vi.mock("@/lib/workflows/library-processing/changes/onboarding", () => ({
	OnboardingChanges: { targetSelectionConfirmed: vi.fn() },
}));
vi.mock("@/lib/utils/slug", () => ({ generateSongSlug: () => "slug" }));

vi.mock("@/lib/workflows/walkthrough-match-preview/service", () => ({
	ensureWalkthroughPreview: (args: unknown) => mockEnsurePreview(args),
}));

vi.mock("@/lib/workflows/walkthrough-match-preview/queries", async () => {
	const actual = await vi.importActual<
		typeof import("@/lib/workflows/walkthrough-match-preview/queries")
	>("@/lib/workflows/walkthrough-match-preview/queries");
	return {
		...actual,
		getWalkthroughPreview: (id: string) => mockGetWalkthroughPreview(id),
	};
});

beforeEach(() => {
	vi.clearAllMocks();
});

function adminWithSong(spotifyId: string) {
	return {
		from: () => ({
			select: () => ({
				eq: () => ({
					single: () =>
						Promise.resolve({ data: { spotify_id: spotifyId }, error: null }),
				}),
				in: () =>
					Promise.resolve({
						data: [
							{
								id: "p1",
								name: "Pl 1",
								description: "d1",
								song_count: 10,
							},
						],
						error: null,
					}),
			}),
		}),
	};
}

describe("getDemoSongMatches", () => {
	it("returns unavailable when no demo song is selected", async () => {
		mockGetOrCreatePreferences.mockResolvedValue(
			Result.ok({ demo_song_id: null }),
		);

		const out = await getDemoSongMatches();
		expect(out.status).toBe("unavailable");
	});

	it("falls back to static demo matches when there are no target playlists", async () => {
		mockGetOrCreatePreferences.mockResolvedValue(
			Result.ok({ demo_song_id: "song-1" }),
		);
		mockGetPlaylists.mockResolvedValue(
			Result.ok([{ id: "p1", is_target: false }]),
		);
		mockCreateAdminSupabaseClient.mockReturnValue(adminWithSong("sp-1"));
		mockGetDemoMatches.mockReturnValue([
			{ id: "demo-pl", name: "Demo", reason: "r", matchScore: 0.9 },
		]);

		const out = await getDemoSongMatches();
		expect(out.status).toBe("ready");
		if (out.status === "ready") {
			expect(out.isDemo).toBe(true);
			expect(out.matches).toHaveLength(1);
		}
		expect(mockGetWalkthroughPreview).not.toHaveBeenCalled();
		expect(mockEnsurePreview).not.toHaveBeenCalled();
	});

	it("returns pending and re-ensures the preview when the row is missing", async () => {
		mockGetOrCreatePreferences.mockResolvedValue(
			Result.ok({ demo_song_id: "song-1" }),
		);
		mockGetPlaylists.mockResolvedValue(
			Result.ok([
				{ id: "p1", is_target: true },
				{ id: "p2", is_target: true },
			]),
		);
		mockGetWalkthroughPreview.mockResolvedValue(Result.ok(null));

		const out = await getDemoSongMatches();
		expect(out.status).toBe("pending");
		// Self-healing: getDemoSongMatches kicks ensure when state looks stale
		// so the worker can satisfy the polling UI without an explicit retrigger.
		expect(mockEnsurePreview).toHaveBeenCalledWith({
			accountId: "acct-1",
			demoSongId: "song-1",
		});
	});

	it("returns pending when fingerprint is stale (targets changed)", async () => {
		mockGetOrCreatePreferences.mockResolvedValue(
			Result.ok({ demo_song_id: "song-1" }),
		);
		mockGetPlaylists.mockResolvedValue(
			Result.ok([
				{ id: "p1", is_target: true },
				{ id: "p2", is_target: true },
			]),
		);
		mockGetWalkthroughPreview.mockResolvedValue(
			Result.ok({
				fingerprint: computePreviewFingerprint("song-1", ["p1"]),
				status: "ready",
				matches: [],
			}),
		);

		const out = await getDemoSongMatches();
		expect(out.status).toBe("pending");
		expect(mockEnsurePreview).toHaveBeenCalled();
	});

	it("returns ready with playlist-decorated scores when preview is fresh", async () => {
		mockGetOrCreatePreferences.mockResolvedValue(
			Result.ok({ demo_song_id: "song-1" }),
		);
		mockGetPlaylists.mockResolvedValue(
			Result.ok([{ id: "p1", is_target: true }]),
		);
		const fp = computePreviewFingerprint("song-1", ["p1"]);
		mockGetWalkthroughPreview.mockResolvedValue(
			Result.ok({
				fingerprint: fp,
				status: "ready",
				matches: [
					{
						playlistId: "p1",
						score: 0.42,
						factors: { embedding: 0.5, audio: 0.3, genre: 0.2 },
					},
				],
			}),
		);
		mockCreateAdminSupabaseClient.mockReturnValue(adminWithSong("sp-1"));

		const out = await getDemoSongMatches();
		expect(out.status).toBe("ready");
		if (out.status === "ready") {
			expect(out.isDemo).toBe(false);
			expect(out.matches).toHaveLength(1);
			expect(out.matches[0]).toMatchObject({ id: "p1", score: 0.42 });
		}
	});

	it("returns pending when preview row is in pending state", async () => {
		mockGetOrCreatePreferences.mockResolvedValue(
			Result.ok({ demo_song_id: "song-1" }),
		);
		mockGetPlaylists.mockResolvedValue(
			Result.ok([{ id: "p1", is_target: true }]),
		);
		const fp = computePreviewFingerprint("song-1", ["p1"]);
		mockGetWalkthroughPreview.mockResolvedValue(
			Result.ok({
				fingerprint: fp,
				status: "pending",
				matches: [],
			}),
		);

		const out = await getDemoSongMatches();
		expect(out.status).toBe("pending");
	});
});
