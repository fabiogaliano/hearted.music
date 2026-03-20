import { describe, expect, it } from "vitest";
import {
	hashModelBundle,
	hashPlaylistProfile,
} from "@/lib/domains/enrichment/embeddings/hashing";
import type { ModelBundle } from "@/lib/domains/enrichment/embeddings/model-bundle";

const baseBundle: ModelBundle = {
	embedding: {
		model: "intfloat/multilingual-e5-large-instruct",
		dims: 1024,
		provider: "deepinfra",
		isInstructionTuned: true,
	},
	algorithms: {
		extractor: 1,
		schema: 1,
		profile: 3,
		matching: "matching_v2",
	},
	enrichment: {
		genreSource: "lastfm",
		emotionEnabled: false,
		playlistProfiling: {
			strategy: "hyde_v1",
			usesIntentQueryEmbedding: true,
			usesHydeColdStart: true,
		},
	},
	version: 1,
};

describe("playlist profile cache invalidation", () => {
	it("bumping profile version changes modelBundleHash", async () => {
		const original = await hashModelBundle(baseBundle);

		const bumped = await hashModelBundle({
			...baseBundle,
			algorithms: { ...baseBundle.algorithms, profile: 4 },
		});

		expect(bumped).not.toBe(original);
	});

	it("changing profiling strategy changes modelBundleHash", async () => {
		const original = await hashModelBundle(baseBundle);

		const changed = await hashModelBundle({
			...baseBundle,
			enrichment: {
				...baseBundle.enrichment,
				playlistProfiling: {
					...baseBundle.enrichment.playlistProfiling,
					strategy: "hyde_v2",
				},
			},
		});

		expect(changed).not.toBe(original);
	});

	it("toggling usesHydeColdStart changes modelBundleHash", async () => {
		const original = await hashModelBundle(baseBundle);

		const changed = await hashModelBundle({
			...baseBundle,
			enrichment: {
				...baseBundle.enrichment,
				playlistProfiling: {
					...baseBundle.enrichment.playlistProfiling,
					usesHydeColdStart: false,
				},
			},
		});

		expect(changed).not.toBe(original);
	});

	it("same playlist content + same bundle => same contentHash", async () => {
		const params = {
			playlistId: "pl-1",
			songIds: ["s1", "s2"],
			descriptionText: "chill vibes",
		};

		const a = await hashPlaylistProfile(params);
		const b = await hashPlaylistProfile(params);

		expect(a).toBe(b);
	});

	it("profile version bump changes contentHash prefix", async () => {
		const params = {
			playlistId: "pl-1",
			songIds: ["s1"],
		};

		const hash = await hashPlaylistProfile(params);
		// contentHash embeds PLAYLIST_PROFILE_VERSION in its prefix
		expect(hash).toMatch(/^pp_v3_/);
	});
});
