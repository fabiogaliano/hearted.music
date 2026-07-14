import { describe, expect, it } from "vitest";
import type { PlaylistIdeaVM, TasteProfileVM } from "../ideaTypes";
import {
	buildPlaylistIdeas,
	defaultSelection,
	reconcileSelection,
	resolveIdea,
	slotOptionsFor,
} from "../playlistIdeas";

const last3m = { kind: "after", startDate: "2026-04-14" } as const;
const first12m = {
	kind: "range",
	startDate: "2017-08-14",
	end: { kind: "date", date: "2018-08-14" },
} as const;

// A profile with both a recent and an origin window, so the window idea's anchor
// is a real two-option toggle (recent lengths differ from origin lengths).
function windowProfile(): TasteProfileVM {
	return profile({
		likedWindows: [
			{ id: "last-3m", label: "last 3 months", count: 24, likedAt: last3m },
			{ id: "last-6m", label: "last 6 months", count: 63, likedAt: last3m },
			{
				id: "first-12m",
				label: "first 12 months",
				count: 5,
				likedAt: first12m,
			},
		],
	});
}

// A profile rich enough to clear every idea floor (windows ≥ 8, genres ≥ 20,
// decades ≥ 3, artists ≥ 8) so buildPlaylistIdeas emits all five ideas.
function profile(overrides: Partial<TasteProfileVM> = {}): TasteProfileVM {
	return {
		totalLikedCount: 500,
		likedWindows: [
			{
				id: "last-3m",
				label: "last 3 months",
				count: 20,
				likedAt: { kind: "after", startDate: "2026-06-12" },
			},
		],
		topGenres: [
			{ name: "indie", count: 120 },
			{ name: "electronic", count: 80 },
		],
		topArtists: [{ name: "Clairo", count: 9 }],
		decades: [{ label: "2010s", from: 2010, to: 2019, count: 214 }],
		...overrides,
	};
}

function ideaById(ideas: PlaylistIdeaVM[], id: string): PlaylistIdeaVM {
	const idea = ideas.find((t) => t.id === id);
	if (!idea) throw new Error(`idea ${id} not built`);
	return idea;
}

function resolveDefault(idea: PlaylistIdeaVM) {
	return resolveIdea(idea, defaultSelection(idea));
}

describe("resolveIdea structured payloads", () => {
	it("resolves the artist idea to a pin target, not an empty idea", () => {
		const idea = resolveDefault(
			ideaById(buildPlaylistIdeas(profile()), "idea-artist"),
		);

		// The original bug: the artist seed produced an empty idea, so the studio
		// opened on the generic library top with no trace of the artist.
		expect(idea.label).toBe("Around Clairo");
		expect(idea.anchorArtist).toBe("Clairo");
		expect(idea.genrePills).toEqual([]);
		expect(idea.matchFilters).toBeUndefined();
	});

	it("resolves the decade idea to a releaseYear range filter", () => {
		const idea = resolveDefault(
			ideaById(buildPlaylistIdeas(profile()), "idea-decade"),
		);

		expect(idea.matchFilters).toEqual({
			version: 1,
			releaseYear: { kind: "range", start: 2010, end: 2019 },
		});
		expect(idea.anchorArtist).toBeUndefined();
	});

	it("resolves the window idea to the window's likedAt filter", () => {
		const idea = resolveDefault(
			ideaById(buildPlaylistIdeas(profile()), "idea-window"),
		);

		expect(idea.matchFilters).toEqual({
			version: 1,
			likedAt: { kind: "after", startDate: "2026-06-12" },
		});
		expect(idea.anchorArtist).toBeUndefined();
	});

	it("resolves a genre idea to pills alone (no filters, no pin)", () => {
		const idea = resolveDefault(
			ideaById(buildPlaylistIdeas(profile()), "idea-genre"),
		);

		expect(idea.genrePills).toHaveLength(1);
		expect(idea.matchFilters).toBeUndefined();
		expect(idea.anchorArtist).toBeUndefined();
	});
});

describe("window idea anchor × length", () => {
	function windowIdea() {
		return ideaById(buildPlaylistIdeas(windowProfile()), "idea-window");
	}

	it("offers both anchors, recent leading, with anchor-specific lengths", () => {
		const idea = windowIdea();
		const anchors = slotOptionsFor(idea, "anchor", {});
		expect(anchors.map((a) => a.label)).toEqual(["last", "first"]);

		const recent = { anchor: anchors[0] };
		const origin = { anchor: anchors[1] };
		expect(slotOptionsFor(idea, "length", recent).map((l) => l.label)).toEqual([
			"3 months",
			"6 months",
		]);
		expect(slotOptionsFor(idea, "length", origin).map((l) => l.label)).toEqual([
			"12 months",
		]);
	});

	it("defaults to the recent anchor's first length as an `after` filter", () => {
		const idea = resolveDefault(windowIdea());
		expect(idea.label).toBe("Your last likes, all 3 months of them");
		expect(idea.matchFilters).toEqual({ version: 1, likedAt: last3m });
	});

	it("resolves the origin anchor to its bounded range filter", () => {
		const idea = windowIdea();
		const anchors = slotOptionsFor(idea, "anchor", {});
		const selection = reconcileSelection(idea, { anchor: anchors[1] });
		const resolved = resolveIdea(idea, selection);
		expect(resolved.label).toBe("Your first likes, all 12 months of them");
		expect(resolved.matchFilters).toEqual({ version: 1, likedAt: first12m });
	});

	it("snaps a stale length back to a valid one when the anchor flips", () => {
		const idea = windowIdea();
		const anchors = slotOptionsFor(idea, "anchor", {});
		// Start on the recent anchor's "6 months", then switch to the origin anchor,
		// which has no 6-month length — the selection must not dangle on the dead pair.
		const recentSix = reconcileSelection(idea, {
			anchor: anchors[0],
			length: slotOptionsFor(idea, "length", { anchor: anchors[0] })[1],
		});
		expect(recentSix.length.label).toBe("6 months");
		const flipped = reconcileSelection(idea, {
			...recentSix,
			anchor: anchors[1],
		});
		expect(flipped.length.label).toBe("12 months");
	});
});

describe("buildPlaylistIdeas facet ordering", () => {
	it("emits facet-ordered: genre (single, blend), time (window, decade), artist", () => {
		const ideas = buildPlaylistIdeas(profile());

		expect(ideas.map((t) => `${t.facet}:${t.id}`)).toEqual([
			"genre:idea-genre",
			"genre:idea-blend",
			"time:idea-window",
			"time:idea-decade",
			"artist:idea-artist",
		]);
	});

	it("skips facets whose signals miss their floors without breaking the order", () => {
		// Only genres clear their floors here — no windows, decades, or artists.
		const ideas = buildPlaylistIdeas(
			profile({ likedWindows: [], decades: [], topArtists: [] }),
		);

		expect(ideas.map((t) => t.id)).toEqual(["idea-genre", "idea-blend"]);
	});
});
