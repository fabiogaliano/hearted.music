import { describe, expect, it } from "vitest";
import type { PlaylistIdeaVM, TasteProfileVM } from "../ideaTypes";
import {
	buildPlaylistIdeas,
	defaultSelection,
	resolveIdea,
} from "../playlistIdeas";

// A profile rich enough to clear every idea floor (windows ≥ 8, genres ≥ 20,
// decades ≥ 3, artists ≥ 8) so buildPlaylistIdeas emits all five ideas.
function profile(overrides: Partial<TasteProfileVM> = {}): TasteProfileVM {
	return {
		totalLikedCount: 500,
		likedWindows: [
			{
				id: "last-30d",
				label: "last 30 days",
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
		expect(idea.pinArtist).toBe("Clairo");
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
		expect(idea.pinArtist).toBeUndefined();
	});

	it("resolves the window idea to the window's likedAt filter", () => {
		const idea = resolveDefault(
			ideaById(buildPlaylistIdeas(profile()), "idea-window"),
		);

		expect(idea.matchFilters).toEqual({
			version: 1,
			likedAt: { kind: "after", startDate: "2026-06-12" },
		});
		expect(idea.pinArtist).toBeUndefined();
	});

	it("resolves a genre idea to pills alone (no filters, no pin)", () => {
		const idea = resolveDefault(
			ideaById(buildPlaylistIdeas(profile()), "idea-genre"),
		);

		expect(idea.genrePills).toHaveLength(1);
		expect(idea.matchFilters).toBeUndefined();
		expect(idea.pinArtist).toBeUndefined();
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
