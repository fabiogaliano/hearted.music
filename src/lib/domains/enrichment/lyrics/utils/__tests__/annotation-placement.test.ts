import { describe, expect, it } from "vitest";
import type { ResponseReferents } from "../../types/genius.types";
import { placeAnnotations } from "../annotation-placement";

const LRCLIB_TEXT = [
	"Like the legend of the phoenix",
	"All ends with beginnings",
	"What keeps the planet spinning",
	"The force from the beginning",
].join("\n");

/** Builds a minimal referent carrying the fields the placer reads. */
function referent(opts: {
	fragment: string;
	body: string;
	id?: number;
	state?: string;
	votes?: number;
	isDescription?: boolean;
}): ResponseReferents {
	return {
		fragment: opts.fragment,
		is_description: opts.isDescription ?? false,
		annotations: [
			{
				id: opts.id ?? 1,
				body: { plain: opts.body },
				verified: false,
				votes_total: opts.votes ?? 50,
				state: opts.state ?? "accepted",
				authors: [{ pinned_role: null }],
			},
		],
	} as unknown as ResponseReferents;
}

describe("placeAnnotations", () => {
	it("produces one 'lyrics' section with every LRCLIB line, ids 1..n", () => {
		const { sections } = placeAnnotations(LRCLIB_TEXT, []);
		expect(sections).toHaveLength(1);
		expect(sections[0].type).toBe("lyrics");
		expect(sections[0].lines.map((l) => l.id)).toEqual([1, 2, 3, 4]);
		expect(sections[0].lines.map((l) => l.text)).toEqual(
			LRCLIB_TEXT.split("\n"),
		);
	});

	it("attaches a matched annotation to the right line and counts it", () => {
		const result = placeAnnotations(LRCLIB_TEXT, [
			referent({
				fragment: "Like the legend of the phoenix",
				body: "Phoenix imagery.",
				id: 7,
			}),
		]);
		expect(result).toMatchObject({ placed: 1, total: 1 });
		const line = result.sections[0].lines[0];
		expect(line.annotations?.[0]).toMatchObject({
			text: "Phoenix imagery.",
			geniusAnnotationId: 7,
		});
		// Other lines carry no annotations.
		expect(result.sections[0].lines[1].annotations).toBeUndefined();
	});

	it("tolerates transcription divergence above the floor", () => {
		// LRCLIB has "All ends with beginnings"; the fragment differs by one word.
		const result = placeAnnotations(LRCLIB_TEXT, [
			referent({ fragment: "All ends with beginning", body: "Cycle." }),
		]);
		expect(result.placed).toBe(1);
		expect(result.sections[0].lines[1].annotations?.[0].text).toBe("Cycle.");
	});

	it("drops a fragment with no LRCLIB home (below floor) but counts it as a candidate", () => {
		const result = placeAnnotations(LRCLIB_TEXT, [
			referent({
				fragment: "Producer tag nowhere in these lyrics at all",
				body: "n/a",
			}),
		]);
		expect(result).toMatchObject({ placed: 0, total: 1 });
		for (const line of result.sections[0].lines) {
			expect(line.annotations).toBeUndefined();
		}
	});

	it("skips description referents entirely (not placed, not counted)", () => {
		const result = placeAnnotations(LRCLIB_TEXT, [
			referent({
				fragment: "Like the legend of the phoenix",
				body: "song-level description",
				isDescription: true,
			}),
		]);
		expect(result).toMatchObject({ placed: 0, total: 0 });
		expect(result.sections[0].lines[0].annotations).toBeUndefined();
	});

	it("excludes low-vote pending annotations (worthiness filter)", () => {
		const result = placeAnnotations(LRCLIB_TEXT, [
			referent({
				fragment: "What keeps the planet spinning",
				body: "fresh community note",
				state: "pending",
				votes: 3,
			}),
		]);
		// The only annotation is unworthy → the referent contributes no candidate.
		expect(result).toMatchObject({ placed: 0, total: 0 });
		expect(result.sections[0].lines[2].annotations).toBeUndefined();
	});

	it("places multiple referents onto their respective lines", () => {
		const result = placeAnnotations(LRCLIB_TEXT, [
			referent({
				fragment: "Like the legend of the phoenix",
				body: "A",
				id: 1,
			}),
			referent({ fragment: "The force from the beginning", body: "B", id: 2 }),
		]);
		expect(result).toMatchObject({ placed: 2, total: 2 });
		expect(result.sections[0].lines[0].annotations?.[0].text).toBe("A");
		expect(result.sections[0].lines[3].annotations?.[0].text).toBe("B");
	});
});
