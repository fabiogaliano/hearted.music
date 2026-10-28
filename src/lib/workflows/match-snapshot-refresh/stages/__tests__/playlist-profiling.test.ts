import { Result } from "better-result";
import { describe, expect, it, vi } from "vitest";
import type { PlaylistProfilingService } from "@/lib/domains/taste/playlist-profiling/service";
import type { ComputedPlaylistProfile } from "@/lib/domains/taste/playlist-profiling/types";
import { DatabaseError } from "@/lib/shared/errors/database";
import { PLAYLISTS, SONGS } from "@/test/fixtures";

const CURRENT_BUNDLE = "bundle-current";

const healthyPlaylist = {
	...PLAYLISTS.years2009to2013,
	match_intent: null,
	genre_pills: null,
};
const failingPlaylist = {
	...PLAYLISTS.oldRock,
	is_target: true,
	match_intent: null,
	genre_pills: null,
};

vi.mock("@/lib/domains/library/playlists/queries", () => ({
	getTargetPlaylists: async () => Result.ok([healthyPlaylist, failingPlaylist]),
	getPlaylistSongs: async () => Result.ok([{ song_id: SONGS.dontHurtMe.id }]),
}));

vi.mock("@/lib/domains/library/songs/queries", () => ({
	getByIds: async () => Result.ok([{ ...SONGS.dontHurtMe, genres: [] }]),
}));

vi.mock("@/lib/domains/enrichment/audio-features/service", () => ({
	createAudioFeaturesService: () => ({
		backfillMissingFeatures: async () => undefined,
	}),
}));

vi.mock("@/lib/domains/enrichment/genre-tagging/service", () => ({
	createGenreEnrichmentService: () => ({ enrichBatch: async () => undefined }),
}));

vi.mock("@/lib/integrations/reccobeats/service", () => ({
	createReccoBeatsService: () => ({}),
}));

vi.mock("@/lib/domains/enrichment/embeddings/versioning", () => ({
	getModelBundleHash: async () => Result.ok(CURRENT_BUNDLE),
}));

const mockCaptureServerError = vi.fn();
vi.mock("@/lib/observability/capture-server-error", () => ({
	captureServerError: (...a: unknown[]) => mockCaptureServerError(...a),
}));

const { loadTargetPlaylistProfiles } = await import("../playlist-profiling");

function storedProfile(
	playlistId: string,
	embedding: number[],
): ComputedPlaylistProfile {
	return {
		playlistId,
		kind: "content_v1",
		embedding,
		audioCentroid: { energy: 0.7 },
		genreDistribution: { rock: 1 },
		songIds: [SONGS.dontHurtMe.id],
		songCount: 1,
		contentHash: `hash-${playlistId}`,
		modelBundleHash: CURRENT_BUNDLE,
		fromCache: true,
	};
}

describe("loadTargetPlaylistProfiles", () => {
	it("a playlist whose profile fails keeps its prior profile instead of being dropped from the snapshot", async () => {
		const profilingService = {
			computeProfile: async (playlistId: string) =>
				playlistId === failingPlaylist.id
					? Result.err(
							new DatabaseError({
								code: "57014",
								message: "statement timeout",
							}),
						)
					: Result.ok(storedProfile(playlistId, [0.1, 0.2])),
			getProfile: async (playlistId: string) =>
				Result.ok(storedProfile(playlistId, [0.9, 0.8])),
		} as unknown as PlaylistProfilingService;

		const { playlists, profiles, carriedForwardCount } =
			await loadTargetPlaylistProfiles("acc-1", profilingService);

		expect(playlists.map((p) => p.id)).toEqual([
			healthyPlaylist.id,
			failingPlaylist.id,
		]);
		expect(profiles).toEqual([
			expect.objectContaining({
				playlistId: healthyPlaylist.id,
				embedding: [0.1, 0.2],
			}),
			{
				playlistId: failingPlaylist.id,
				embedding: [0.9, 0.8],
				audioCentroid: { energy: 0.7 },
				genreDistribution: { rock: 1 },
				hasGenrePills: false,
			},
		]);
		expect(carriedForwardCount).toBe(1);
		expect(mockCaptureServerError).toHaveBeenCalledOnce();
	});
});
