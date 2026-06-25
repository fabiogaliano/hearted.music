import { describe, expect, it } from "vitest";
import { hashMatchSnapshot, hashRankingConfig } from "../hashing";

const BASE_PARAMS = {
	schemaVersion: "oriented-suggestion-lists-v1",
	instructionByOrientation: {
		song: "Given a song, rank playlists.",
		playlist: "Given a playlist, rank songs.",
	},
	orientations: ["song", "playlist"] as const,
	storedPairsPerSong: 20,
	storedPairsPerPlaylist: 20,
};

describe("hashRankingConfig", () => {
	it("produces a hash with the rk_ prefix", async () => {
		const hash = await hashRankingConfig(BASE_PARAMS);
		expect(hash).toMatch(/^rk_/);
	});

	it("is stable when called twice with identical inputs", async () => {
		const a = await hashRankingConfig(BASE_PARAMS);
		const b = await hashRankingConfig({ ...BASE_PARAMS });
		expect(a).toBe(b);
	});

	it("changes when schema version changes", async () => {
		const original = await hashRankingConfig(BASE_PARAMS);
		const changed = await hashRankingConfig({
			...BASE_PARAMS,
			schemaVersion: "oriented-suggestion-lists-v2",
		});
		expect(changed).not.toBe(original);
	});

	it("changes when a rerank instruction changes", async () => {
		const original = await hashRankingConfig(BASE_PARAMS);
		const changed = await hashRankingConfig({
			...BASE_PARAMS,
			instructionByOrientation: {
				...BASE_PARAMS.instructionByOrientation,
				song: "Updated song instruction.",
			},
		});
		expect(changed).not.toBe(original);
	});

	it("changes when the orientations list changes", async () => {
		const original = await hashRankingConfig(BASE_PARAMS);
		const changed = await hashRankingConfig({
			...BASE_PARAMS,
			orientations: ["song"] as const,
		});
		expect(changed).not.toBe(original);
	});

	it("changes when storedPairsPerSong changes", async () => {
		const original = await hashRankingConfig(BASE_PARAMS);
		const changed = await hashRankingConfig({
			...BASE_PARAMS,
			storedPairsPerSong: 50,
		});
		expect(changed).not.toBe(original);
	});

	it("changes when storedPairsPerPlaylist changes", async () => {
		const original = await hashRankingConfig(BASE_PARAMS);
		const changed = await hashRankingConfig({
			...BASE_PARAMS,
			storedPairsPerPlaylist: 50,
		});
		expect(changed).not.toBe(original);
	});

	it("is orientation-insertion-order-stable (same set, different array order)", async () => {
		const a = await hashRankingConfig({
			...BASE_PARAMS,
			orientations: ["song", "playlist"] as const,
		});
		const b = await hashRankingConfig({
			...BASE_PARAMS,
			orientations: ["playlist", "song"] as const,
		});
		expect(a).toBe(b);
	});
});

describe("hashMatchSnapshot with rankingConfigHash", () => {
	const SNAPSHOT_BASE = {
		candidateSetHash: "cs_abc",
		playlistSetHash: "ps_def",
		configHash: "mc_ghi",
		rerankerConfigHash: "rc_jkl",
		modelBundleHash: "mb_mno",
	};

	it("changes snapshot hash when rankingConfigHash changes", async () => {
		const rk1 = await hashRankingConfig(BASE_PARAMS);
		const rk2 = await hashRankingConfig({
			...BASE_PARAMS,
			schemaVersion: "oriented-suggestion-lists-v2",
		});

		const snap1 = await hashMatchSnapshot({
			...SNAPSHOT_BASE,
			rankingConfigHash: rk1,
		});
		const snap2 = await hashMatchSnapshot({
			...SNAPSHOT_BASE,
			rankingConfigHash: rk2,
		});

		expect(snap1).not.toBe(snap2);
	});

	it("snapshot hash is stable when rankingConfigHash is unchanged", async () => {
		const rk = await hashRankingConfig(BASE_PARAMS);
		const a = await hashMatchSnapshot({
			...SNAPSHOT_BASE,
			rankingConfigHash: rk,
		});
		const b = await hashMatchSnapshot({
			...SNAPSHOT_BASE,
			rankingConfigHash: rk,
		});
		expect(a).toBe(b);
	});

	it("snapshot hash with rankingConfigHash differs from snapshot without it", async () => {
		const rk = await hashRankingConfig(BASE_PARAMS);
		const withRanking = await hashMatchSnapshot({
			...SNAPSHOT_BASE,
			rankingConfigHash: rk,
		});
		const withoutRanking = await hashMatchSnapshot({ ...SNAPSHOT_BASE });
		expect(withRanking).not.toBe(withoutRanking);
	});
});
