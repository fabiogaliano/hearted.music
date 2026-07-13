import { describe, expect, it } from "vitest";
import {
	buildSeedTemplates,
	defaultSelection,
	resolveTemplate,
} from "../seedPresets";
import type { SeedTemplateVM, TasteProfileVM } from "../seedTypes";

// A profile rich enough to clear every template floor (windows ≥ 8, genres ≥ 20,
// decades ≥ 20, artists ≥ 8) so buildSeedTemplates emits all five templates.
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

function templateById(templates: SeedTemplateVM[], id: string): SeedTemplateVM {
	const template = templates.find((t) => t.id === id);
	if (!template) throw new Error(`template ${id} not built`);
	return template;
}

function resolveDefault(template: SeedTemplateVM) {
	return resolveTemplate(template, defaultSelection(template));
}

describe("resolveTemplate structured payloads", () => {
	it("resolves the artist template to a pin target, not an empty preset", () => {
		const preset = resolveDefault(
			templateById(buildSeedTemplates(profile()), "tpl-artist"),
		);

		// The original bug: the artist seed produced an empty preset, so the studio
		// opened on the generic library top with no trace of the artist.
		expect(preset.label).toBe("Around Clairo");
		expect(preset.pinArtist).toBe("Clairo");
		expect(preset.genrePills).toEqual([]);
		expect(preset.matchFilters).toBeUndefined();
	});

	it("resolves the decade template to a releaseYear range filter", () => {
		const preset = resolveDefault(
			templateById(buildSeedTemplates(profile()), "tpl-decade"),
		);

		expect(preset.matchFilters).toEqual({
			version: 1,
			releaseYear: { kind: "range", start: 2010, end: 2019 },
		});
		expect(preset.pinArtist).toBeUndefined();
	});

	it("resolves the window template to the window's likedAt filter", () => {
		const preset = resolveDefault(
			templateById(buildSeedTemplates(profile()), "tpl-window"),
		);

		expect(preset.matchFilters).toEqual({
			version: 1,
			likedAt: { kind: "after", startDate: "2026-06-12" },
		});
		expect(preset.pinArtist).toBeUndefined();
	});

	it("resolves a genre template to pills alone (no filters, no pin)", () => {
		const preset = resolveDefault(
			templateById(buildSeedTemplates(profile()), "tpl-genre"),
		);

		expect(preset.genrePills).toHaveLength(1);
		expect(preset.matchFilters).toBeUndefined();
		expect(preset.pinArtist).toBeUndefined();
	});
});

describe("buildSeedTemplates facet ordering", () => {
	it("emits facet-ordered: genre (single, blend), time (window, decade), artist", () => {
		const templates = buildSeedTemplates(profile());

		expect(templates.map((t) => `${t.facet}:${t.id}`)).toEqual([
			"genre:tpl-genre",
			"genre:tpl-blend",
			"time:tpl-window",
			"time:tpl-decade",
			"artist:tpl-artist",
		]);
	});

	it("skips facets whose signals miss their floors without breaking the order", () => {
		// Only genres clear their floors here — no windows, decades, or artists.
		const templates = buildSeedTemplates(
			profile({ likedWindows: [], decades: [], topArtists: [] }),
		);

		expect(templates.map((t) => t.id)).toEqual(["tpl-genre", "tpl-blend"]);
	});
});
