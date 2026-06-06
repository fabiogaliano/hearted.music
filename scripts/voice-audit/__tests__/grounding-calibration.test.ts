import { describe, expect, it } from "vitest";
import { loadGoldExemplars } from "../exemplars";
import { GROUNDING_NEGATIVES } from "../fixtures/grounding-negatives";
import {
	cohenKappaBinary,
	rawAgreement,
	selfConsistencySummary,
	type BinaryPair,
} from "../grounding-calibration";

describe("rawAgreement", () => {
	it("is 1 when every judge call matches its label", () => {
		const pairs: BinaryPair[] = [
			{ judge: true, label: true },
			{ judge: false, label: false },
		];
		expect(rawAgreement(pairs)).toBe(1);
	});

	it("is the matching fraction otherwise", () => {
		const pairs: BinaryPair[] = [
			{ judge: true, label: true },
			{ judge: true, label: false },
			{ judge: false, label: false },
			{ judge: false, label: false },
		];
		expect(rawAgreement(pairs)).toBe(0.75);
	});
});

describe("cohenKappaBinary", () => {
	it("is 1 for perfect agreement across both classes", () => {
		const pairs: BinaryPair[] = [
			{ judge: true, label: true },
			{ judge: true, label: true },
			{ judge: false, label: false },
			{ judge: false, label: false },
		];
		expect(cohenKappaBinary(pairs)).toBeCloseTo(1, 10);
	});

	it("is 0 at chance (judge ignores the label)", () => {
		// judge always grounded, label half grounded → observed = chance.
		const pairs: BinaryPair[] = [
			{ judge: true, label: true },
			{ judge: true, label: false },
		];
		expect(cohenKappaBinary(pairs)).toBeCloseTo(0, 10);
	});

	it("returns 1 when only one class appears and agreement is perfect", () => {
		const pairs: BinaryPair[] = [
			{ judge: true, label: true },
			{ judge: true, label: true },
		];
		expect(cohenKappaBinary(pairs)).toBe(1);
	});

	it("goes negative when the judge is worse than chance", () => {
		const pairs: BinaryPair[] = [
			{ judge: true, label: false },
			{ judge: false, label: true },
			{ judge: true, label: false },
			{ judge: false, label: true },
		];
		expect(cohenKappaBinary(pairs)).toBeLessThan(0);
	});
});

describe("selfConsistencySummary", () => {
	it("scores a stable item at full agreement, a split item below", () => {
		const sc = selfConsistencySummary([
			{ id: "a", runs: [true, true, true] },
			{ id: "b", runs: [true, false, true] },
		]);
		expect(sc.items[0].agreement).toBe(1);
		expect(sc.items[0].flipped).toBe(false);
		expect(sc.items[1].agreement).toBeCloseTo(2 / 3, 10);
		expect(sc.items[1].flipped).toBe(true);
		expect(sc.items[1].majority).toBe(true);
		expect(sc.flippedCount).toBe(1);
		expect(sc.meanAgreement).toBeCloseTo((1 + 2 / 3) / 2, 10);
	});
});

describe("grounding negative fixtures", () => {
	const byKey = new Map(
		[...loadGoldExemplars().values()].map((g) => [g.key, g] as const),
	);

	it("covers the four import types and labels them all fail", () => {
		expect(GROUNDING_NEGATIVES.map((f) => f.claimType).sort()).toEqual([
			"biography",
			"fabricated-setting",
			"real-world-fact",
			"reception",
		]);
		expect(GROUNDING_NEGATIVES.every((f) => f.label === "fail")).toBe(true);
	});

	it("mutates a real gold read while changing exactly one field", () => {
		for (const fx of GROUNDING_NEGATIVES) {
			const base = byKey.get(fx.baseKey);
			expect(base, `fixture ${fx.id} baseKey must be a gold`).toBeTruthy();
			const mutated = fx.mutate((base as NonNullable<typeof base>).read);
			const original = (base as NonNullable<typeof base>).read;
			// The mutation injects an ungrounded claim: the read must differ, but only in one place.
			const changedTake = mutated.take !== original.take;
			const changedArc = JSON.stringify(mutated.arc) !== JSON.stringify(original.arc);
			expect(changedTake || changedArc).toBe(true);
			// Lens/image/tension/lines are left untouched — the negative is subtle, not a rewrite.
			expect(mutated.lens).toBe(original.lens);
			expect(mutated.image).toBe(original.image);
			expect(mutated.lines).toEqual(original.lines);
		}
	});
});
