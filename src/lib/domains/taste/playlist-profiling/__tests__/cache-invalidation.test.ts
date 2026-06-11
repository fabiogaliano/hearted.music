import { describe, expect, it } from "vitest";
import {
	hashModelBundle,
	hashPlaylistProfile,
} from "@/lib/domains/enrichment/embeddings/hashing";
import type { ModelBundle } from "@/lib/domains/enrichment/embeddings/model-bundle";

const baseBundle: ModelBundle = {
	embedding: {
		model: "Qwen/Qwen3-Embedding-0.6B",
		dims: 512,
		provider: "deepinfra",
		isInstructionTuned: true,
		queryTask: "Given a playlist's mood and theme, retrieve songs that fit it",
	},
	algorithms: {
		extractor: 1,
		schema: 1,
		profile: 3,
		matching: "matching_v2",
		genreTable: "0.0.0",
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

	it("rewording the query task instruction changes modelBundleHash", async () => {
		const original = await hashModelBundle(baseBundle);

		const changed = await hashModelBundle({
			...baseBundle,
			embedding: {
				...baseBundle.embedding,
				queryTask: "Given a song description, retrieve similar songs",
			},
		});

		expect(changed).not.toBe(original);
	});

	it("toggling isInstructionTuned changes modelBundleHash", async () => {
		const original = await hashModelBundle(baseBundle);

		const changed = await hashModelBundle({
			...baseBundle,
			embedding: { ...baseBundle.embedding, isInstructionTuned: false },
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

	it("namespaces contentHash with a profile-version prefix so versions can't collide", async () => {
		const params = {
			playlistId: "pl-1",
			songIds: ["s1"],
		};

		const hash = await hashPlaylistProfile(params);
		// The version number itself is asserted by the modelBundleHash tests; here
		// we only guard that the prefix mechanism stays in place (matching the
		// literal v3 would just mirror PLAYLIST_PROFILE_VERSION and break on bumps).
		expect(hash).toMatch(/^pp_v\d+_/);
	});
});
