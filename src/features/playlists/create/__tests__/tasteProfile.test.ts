import { describe, expect, it, vi } from "vitest";
import type { TasteProfile } from "@/lib/domains/library/liked-songs/taste-profile-queries";

// tasteProfile.ts imports the getTasteProfile server fn; stub the module so this
// pure-mapping test doesn't drag the server graph into the test environment.
vi.mock("@/lib/server/playlists.functions", () => ({
	getTasteProfile: vi.fn(),
}));

const { toTasteProfileVM } = await import("../tasteProfile");

function domainProfile(overrides: Partial<TasteProfile> = {}): TasteProfile {
	return {
		totalLikedCount: 1238,
		topGenres: [{ name: "indie", count: 340 }],
		topArtists: [{ name: "KAYTRANADA", count: 26 }],
		likedWindows: [],
		decades: [],
		...overrides,
	};
}

describe("toTasteProfileVM", () => {
	it("labels windows, orders them by recency, and resolves each likedAt filter", () => {
		const vm = toTasteProfileVM(
			domainProfile({
				likedWindows: [
					{
						id: "first-3m",
						count: 64,
						from: "2024-01-10T08:00:00Z",
						to: "2024-04-10T08:00:00Z",
					},
					{ id: "last-30d", count: 47, from: "2026-06-12T00:00:00Z", to: null },
					{ id: "last-6m", count: 257, from: "2026-01-12T00:00:00Z", to: null },
				],
			}),
		);

		expect(vm.likedWindows).toEqual([
			{
				id: "last-30d",
				label: "last 30 days",
				count: 47,
				likedAt: { kind: "after", startDate: "2026-06-12" },
			},
			{
				id: "last-6m",
				label: "last 6 months",
				count: 257,
				likedAt: { kind: "after", startDate: "2026-01-12" },
			},
			{
				id: "first-3m",
				label: "first 3 months",
				count: 64,
				likedAt: {
					kind: "range",
					startDate: "2024-01-10",
					end: { kind: "date", date: "2024-04-10" },
				},
			},
		]);
	});

	it("drops windows whose id has no label (allow-list)", () => {
		const vm = toTasteProfileVM(
			domainProfile({
				likedWindows: [
					{ id: "last-30d", count: 5, from: "2026-06-12T00:00:00Z", to: null },
					{
						id: "last-decade",
						count: 900,
						from: "2016-01-01T00:00:00Z",
						to: null,
					},
				],
			}),
		);

		expect(vm.likedWindows.map((w) => w.id)).toEqual(["last-30d"]);
	});

	it("renders decade labels as '<start>s' and keeps the year bounds", () => {
		const vm = toTasteProfileVM(
			domainProfile({
				decades: [
					{ decadeStart: 2010, from: 2010, to: 2019, count: 214 },
					{ decadeStart: 2020, from: 2020, to: 2026, count: 30 },
				],
			}),
		);

		expect(vm.decades).toEqual([
			{ label: "2010s", from: 2010, to: 2019, count: 214 },
			{ label: "2020s", from: 2020, to: 2026, count: 30 },
		]);
	});

	it("passes total, genres, and artists through unchanged", () => {
		const vm = toTasteProfileVM(domainProfile());

		expect(vm.totalLikedCount).toBe(1238);
		expect(vm.topGenres).toEqual([{ name: "indie", count: 340 }]);
		expect(vm.topArtists).toEqual([{ name: "KAYTRANADA", count: 26 }]);
	});
});
