/**
 * Unit tests for the shared visibility-policy module.
 *
 * Covers the read-time filter hash, the policy hash, and the two pure pair
 * predicates (passesPlaylistFilters, passesVisibilityPolicyForPair) that both
 * queue derivation and card presentation share.
 */

import { describe, expect, it } from "vitest";
import type { SongFilterMetadata } from "@/lib/domains/taste/match-filters/predicates";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import type { QueueVisibilityConfigHashInput } from "../types";
import {
	computeReadTimeFiltersHash,
	computeVisibilityConfigHash,
	computeVisibilityPolicyHash,
	NULL_SONG_FILTER_METADATA,
	passesPlaylistFilters,
	passesVisibilityPolicyForPair,
	type VisibilityPolicy,
} from "../visibility-policy";

const NOW_MS = new Date("2024-06-01T00:00:00Z").getTime();

const FULL_META: SongFilterMetadata = {
	language: "en",
	languageSecondary: null,
	releaseYear: 2020,
	vocalGender: "female",
	likedAt: new Date("2023-01-15T00:00:00Z").getTime(),
};

describe("computeReadTimeFiltersHash", () => {
	it("returns stable value for empty filter map", () => {
		expect(computeReadTimeFiltersHash(new Map())).toBe(
			computeReadTimeFiltersHash(new Map()),
		);
	});

	it("starts with rtf_ prefix", () => {
		expect(computeReadTimeFiltersHash(new Map())).toMatch(/^rtf_/);
	});

	it("changes when a filter is added", () => {
		const noFilters = computeReadTimeFiltersHash(new Map());
		const withFilter = computeReadTimeFiltersHash(
			new Map<string, PlaylistMatchFiltersV1 | null>([
				["pl-1", { version: 1, languages: { codes: ["en"] } }],
			]),
		);
		expect(noFilters).not.toBe(withFilter);
	});

	it("is independent of Map insertion order", () => {
		const m1 = new Map<string, PlaylistMatchFiltersV1 | null>([
			["pl-a", { version: 1 }],
			["pl-b", { version: 1, vocalGender: "female" }],
		]);
		const m2 = new Map<string, PlaylistMatchFiltersV1 | null>([
			["pl-b", { version: 1, vocalGender: "female" }],
			["pl-a", { version: 1 }],
		]);
		expect(computeReadTimeFiltersHash(m1)).toBe(computeReadTimeFiltersHash(m2));
	});

	// Finding 3: a liked-at "today" range resolves against the current UTC date,
	// so the same stored config must hash differently across midnight — otherwise
	// appendSnapshotDelta short-circuits on the already-applied key and never
	// re-evaluates a snapshot whose visible set widened overnight.
	it("changes across UTC dates when a liked-at 'today' filter is active", () => {
		const todayFilter = new Map<string, PlaylistMatchFiltersV1 | null>([
			[
				"pl-1",
				{
					version: 1,
					likedAt: {
						kind: "range",
						startDate: "2024-01-01",
						end: { kind: "today" },
					},
				},
			],
		]);
		const day1 = new Date("2024-06-01T12:00:00Z").getTime();
		const day2 = new Date("2024-06-02T12:00:00Z").getTime();
		expect(computeReadTimeFiltersHash(todayFilter, day1)).not.toBe(
			computeReadTimeFiltersHash(todayFilter, day2),
		);
	});

	it("ignores nowMs when no liked-at 'today' filter is present (hash stays date-stable)", () => {
		const dateFilter = new Map<string, PlaylistMatchFiltersV1 | null>([
			[
				"pl-1",
				{
					version: 1,
					likedAt: {
						kind: "range",
						startDate: "2024-01-01",
						end: { kind: "date", date: "2024-05-01" },
					},
				},
			],
		]);
		const day1 = new Date("2024-06-01T12:00:00Z").getTime();
		const day2 = new Date("2024-06-02T12:00:00Z").getTime();
		// A fixed-date range and a config without nowMs all agree: no "today"
		// resolution means the date never enters the hash.
		expect(computeReadTimeFiltersHash(dateFilter, day1)).toBe(
			computeReadTimeFiltersHash(dateFilter, day2),
		);
		expect(computeReadTimeFiltersHash(dateFilter, day1)).toBe(
			computeReadTimeFiltersHash(dateFilter),
		);
	});
});

describe("computeVisibilityConfigHash", () => {
	const baseInput: QueueVisibilityConfigHashInput = {
		orientation: "song",
		minScore: 0.5,
		readTimeFiltersHash: "rtf_00000001",
	};

	it("same inputs produce the same hash (idempotency)", () => {
		expect(computeVisibilityConfigHash(baseInput)).toBe(
			computeVisibilityConfigHash({ ...baseInput }),
		);
	});

	it("changed readTimeFiltersHash produces a different visibility hash", () => {
		expect(computeVisibilityConfigHash(baseInput)).not.toBe(
			computeVisibilityConfigHash({
				...baseInput,
				readTimeFiltersHash: "rtf_00000002",
			}),
		);
	});

	it("changed minScore produces a different visibility hash", () => {
		expect(computeVisibilityConfigHash(baseInput)).not.toBe(
			computeVisibilityConfigHash({ ...baseInput, minScore: 0.3 }),
		);
	});

	it("changed orientation produces a different visibility hash", () => {
		expect(computeVisibilityConfigHash(baseInput)).not.toBe(
			computeVisibilityConfigHash({ ...baseInput, orientation: "playlist" }),
		);
	});
});

describe("computeVisibilityPolicyHash", () => {
	it("matches computeVisibilityConfigHash with the policy's filter hash", () => {
		const filters = new Map<string, PlaylistMatchFiltersV1 | null>([
			["pl-a", { version: 1, languages: { codes: ["en"] } }],
		]);
		const policy: VisibilityPolicy = {
			orientation: "song",
			minScore: 0.5,
			filtersByPlaylistId: filters,
		};
		expect(computeVisibilityPolicyHash(policy)).toBe(
			computeVisibilityConfigHash({
				orientation: "song",
				minScore: 0.5,
				readTimeFiltersHash: computeReadTimeFiltersHash(filters),
			}),
		);
	});

	it("changes when the policy's filters change", () => {
		const strict: VisibilityPolicy = {
			orientation: "song",
			minScore: 0.5,
			filtersByPlaylistId: new Map([
				["pl-a", { version: 1, languages: { codes: ["en"] } }],
			]),
		};
		const loosened: VisibilityPolicy = {
			...strict,
			filtersByPlaylistId: new Map([["pl-a", null]]),
		};
		expect(computeVisibilityPolicyHash(strict)).not.toBe(
			computeVisibilityPolicyHash(loosened),
		);
	});
});

describe("passesPlaylistFilters", () => {
	it("passes when filters are null (no filter set)", () => {
		expect(passesPlaylistFilters(null, NULL_SONG_FILTER_METADATA, NOW_MS)).toBe(
			true,
		);
	});

	it("passes when filters are undefined", () => {
		expect(
			passesPlaylistFilters(undefined, NULL_SONG_FILTER_METADATA, NOW_MS),
		).toBe(true);
	});

	it("fails an active filter when song metadata is null (all-null substitution)", () => {
		expect(
			passesPlaylistFilters(
				{ version: 1, languages: { codes: ["en"] } },
				null,
				NOW_MS,
			),
		).toBe(false);
	});

	it("passes an empty filter object even when song metadata is null", () => {
		expect(passesPlaylistFilters({ version: 1 }, null, NOW_MS)).toBe(true);
	});

	it("passes an active filter when metadata matches", () => {
		expect(
			passesPlaylistFilters(
				{ version: 1, languages: { codes: ["en"] } },
				FULL_META,
				NOW_MS,
			),
		).toBe(true);
	});
});

describe("passesVisibilityPolicyForPair", () => {
	const row = (
		song_id: string,
		playlist_id: string,
		score: number,
		fused_score: number | null = null,
	) => ({ song_id, playlist_id, score, fused_score });

	function policy(
		minScore: number,
		filters: Map<string, PlaylistMatchFiltersV1 | null> = new Map(),
	): VisibilityPolicy {
		return { orientation: "song", minScore, filtersByPlaylistId: filters };
	}

	it("fails a pair below the strictness bar", () => {
		expect(
			passesVisibilityPolicyForPair({
				row: row("s1", "pl-a", 0.3),
				policy: policy(0.5),
				decidedPairs: new Set(),
				songMetaBySongId: new Map(),
				nowMs: NOW_MS,
			}),
		).toBe(false);
	});

	it("fails a decided pair", () => {
		expect(
			passesVisibilityPolicyForPair({
				row: row("s1", "pl-a", 0.9),
				policy: policy(0.5),
				decidedPairs: new Set(["s1:pl-a"]),
				songMetaBySongId: new Map(),
				nowMs: NOW_MS,
			}),
		).toBe(false);
	});

	it("passes an undecided, above-bar pair with no filters set", () => {
		expect(
			passesVisibilityPolicyForPair({
				row: row("s1", "pl-a", 0.9),
				policy: policy(0.5),
				decidedPairs: new Set(),
				songMetaBySongId: new Map(),
				nowMs: NOW_MS,
			}),
		).toBe(true);
	});

	it("fails when the playlist filter is active and the song metadata is missing", () => {
		const filters = new Map<string, PlaylistMatchFiltersV1 | null>([
			["pl-a", { version: 1, languages: { codes: ["en"] } }],
		]);
		expect(
			passesVisibilityPolicyForPair({
				row: row("s1", "pl-a", 0.9),
				policy: policy(0.5, filters),
				decidedPairs: new Set(),
				songMetaBySongId: new Map(), // s1 absent → all-null metadata
				nowMs: NOW_MS,
			}),
		).toBe(false);
	});

	it("passes when the playlist filter is active and the song metadata matches", () => {
		const filters = new Map<string, PlaylistMatchFiltersV1 | null>([
			["pl-a", { version: 1, languages: { codes: ["en"] } }],
		]);
		expect(
			passesVisibilityPolicyForPair({
				row: row("s1", "pl-a", 0.9),
				policy: policy(0.5, filters),
				decidedPairs: new Set(),
				songMetaBySongId: new Map([["s1", FULL_META]]),
				nowMs: NOW_MS,
			}),
		).toBe(true);
	});
});
