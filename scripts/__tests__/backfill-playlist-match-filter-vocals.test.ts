import { describe, expect, it, vi } from "vitest";
import {
	parseArgs,
	decidePlaylist,
	writeBatch,
	type PlaylistRow,
	type DecisionKind,
} from "../backfill-playlist-match-filter-vocals";

function argv(...args: string[]): string[] {
	return ["bun", "backfill-playlist-match-filter-vocals.ts", ...args];
}

describe("parseArgs", () => {
	it("defaults to dry-run when no flags are passed", () => {
		const opts = parseArgs(argv());
		expect(opts.dryRun).toBe(true);
	});

	it("is dry-run when --dry-run is explicit", () => {
		const opts = parseArgs(argv("--dry-run"));
		expect(opts.dryRun).toBe(true);
	});

	it("is apply mode when --apply is passed", () => {
		const opts = parseArgs(argv("--apply"));
		expect(opts.dryRun).toBe(false);
	});

	it("treats --no-apply as a dry-run alias", () => {
		const opts = parseArgs(argv("--no-apply"));
		expect(opts.dryRun).toBe(true);
	});

	it("exits on conflicting --apply and --dry-run", () => {
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("process.exit");
		});
		expect(() => parseArgs(argv("--apply", "--dry-run"))).toThrow();
		exitSpy.mockRestore();
	});

	it("exits on unknown flags so typos can't accidentally pick dry-run", () => {
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("process.exit");
		});
		expect(() => parseArgs(argv("--aply"))).toThrow();
		exitSpy.mockRestore();
	});
});

function makeRow(overrides: Partial<PlaylistRow> = {}): PlaylistRow {
	return {
		id: "playlist-1",
		account_id: "account-1",
		match_intent: "female vocals indie",
		match_filters: { version: 1 },
		genre_pills: [],
		is_target: false,
		...overrides,
	};
}

describe("decidePlaylist – skip-existing (idempotency)", () => {
	it("skips a playlist that already has vocalGender=female", () => {
		const d = decidePlaylist(
			makeRow({ match_filters: { version: 1, vocalGender: "female" } }),
		);
		expect(d.kind).toBe("skip-existing");
		expect(d.newFilters).toBeUndefined();
	});

	it("skips a playlist that already has vocalGender=male", () => {
		const d = decidePlaylist(
			makeRow({ match_filters: { version: 1, vocalGender: "male" } }),
		);
		expect(d.kind).toBe("skip-existing");
	});

	it("does not overwrite existing vocalGender even when the intent would detect differently", () => {
		// Intent says "female" but stored says "male" — stored wins (skip-existing).
		const d = decidePlaylist(
			makeRow({
				match_intent: "female vocals",
				match_filters: { version: 1, vocalGender: "male" },
			}),
		);
		expect(d.kind).toBe("skip-existing");
	});
});

describe("decidePlaylist – skip-invalid", () => {
	it("skips a playlist whose stored match_filters has an invalid known field", () => {
		// version is a known field; wrong value triggers wasNormalized.
		const d = decidePlaylist(
			makeRow({ match_filters: { version: 99 } }),
		);
		expect(d.kind).toBe("skip-invalid");
	});

	it("skips null stored filters (treated as invalid by the forgiving parser)", () => {
		// null is not an object with version:1, so the stored parser normalizes.
		const d = decidePlaylist(makeRow({ match_filters: null }));
		expect(d.kind).toBe("skip-invalid");
	});
});

describe("decidePlaylist – skip-ambiguous", () => {
	it("skips intent text that has both female and male signals", () => {
		const d = decidePlaylist(
			makeRow({ match_intent: "male and female vocals mix" }),
		);
		expect(d.kind).toBe("skip-ambiguous");
	});
});

describe("decidePlaylist – skip-none", () => {
	it("skips intent text with no vocal-gender signal", () => {
		const d = decidePlaylist(
			makeRow({ match_intent: "ambient electronic focus music" }),
		);
		expect(d.kind).toBe("skip-none");
	});
});

describe("decidePlaylist – write-female", () => {
	it("plans a write for unambiguous female intent with no existing vocalGender", () => {
		const d = decidePlaylist(
			makeRow({ match_intent: "female-fronted indie rock" }),
		);
		expect(d.kind).toBe("write-female");
		expect(d.newFilters?.vocalGender).toBe("female");
	});

	it("preserves existing non-vocals filters when writing vocalGender", () => {
		const d = decidePlaylist(
			makeRow({
				match_intent: "female vocalist jazz",
				match_filters: {
					version: 1,
					languages: { codes: ["en"] },
					releaseYear: { kind: "after", start: 2000 },
				},
			}),
		);
		expect(d.kind).toBe("write-female");
		expect(d.newFilters?.vocalGender).toBe("female");
		expect(d.newFilters?.languages).toEqual({ codes: ["en"] });
		expect(d.newFilters?.releaseYear).toEqual({ kind: "after", start: 2000 });
	});

	it("includes isTarget in the decision for later invalidation gating", () => {
		const d = decidePlaylist(
			makeRow({ match_intent: "women singers blues", is_target: true }),
		);
		expect(d.kind).toBe("write-female");
		expect(d.isTarget).toBe(true);
	});
});

describe("decidePlaylist – write-male", () => {
	it("plans a write for unambiguous male intent with no existing vocalGender", () => {
		const d = decidePlaylist(
			makeRow({ match_intent: "male vocalist soul" }),
		);
		expect(d.kind).toBe("write-male");
		expect(d.newFilters?.vocalGender).toBe("male");
	});

	it("preserves existing filters when writing male vocalGender", () => {
		const d = decidePlaylist(
			makeRow({
				match_intent: "men singers country",
				match_filters: {
					version: 1,
					likedAt: { kind: "after", startDate: "2020-01-01" },
				},
			}),
		);
		expect(d.kind).toBe("write-male");
		expect(d.newFilters?.vocalGender).toBe("male");
		expect(d.newFilters?.likedAt).toEqual({
			kind: "after",
			startDate: "2020-01-01",
		});
	});
});

describe("decidePlaylist – dry-run writes nothing (structural check)", () => {
	it("produces a write decision without a newFilters=undefined when kind is write-*", () => {
		// The script guards on kind before calling writeBatch; here we confirm
		// that a write decision always carries newFilters.
		const d = decidePlaylist(makeRow({ match_intent: "female vocals" }));
		expect(d.kind).toMatch(/^write-/);
		expect(d.newFilters).toBeDefined();
	});

	it("produces skip decisions without newFilters (nothing to write)", () => {
		const skipKinds: DecisionKind[] = [
			"skip-existing",
			"skip-ambiguous",
			"skip-none",
			"skip-invalid",
		];

		const rows = [
			makeRow({ match_filters: { version: 1, vocalGender: "female" } }),
			makeRow({ match_intent: "male and female singer" }),
			makeRow({ match_intent: "ambient focus" }),
			makeRow({ match_filters: { version: 99 } }),
		];

		const decisions = rows.map(decidePlaylist);
		for (const d of decisions) {
			expect(skipKinds).toContain(d.kind);
			expect(d.newFilters).toBeUndefined();
		}
	});
});

describe("decidePlaylist – unknown stored keys are tolerated (forgiving read parse)", () => {
	it("does not treat an unknown stored key as invalid", () => {
		// The forgiving parser strips unknown keys; wasNormalized stays false.
		const d = decidePlaylist(
			makeRow({
				match_intent: "female vocals",
				match_filters: { version: 1, unknownFutureKey: "ignored" },
			}),
		);
		// Should reach the detector, not stop at skip-invalid.
		expect(d.kind).toBe("write-female");
	});
});

describe("writeBatch – dry-run guard", () => {
	it("throws immediately when dryRun=true, never touching the DB", async () => {
		// Calling writeBatch with dryRun=true must throw before any supabase call.
		// A stub supabase that throws if reached proves the guard fires first.
		const neverCalledSupabase = {
			from: () => {
				throw new Error("supabase should not be called in dry-run");
			},
		} as never;

		await expect(
			writeBatch(neverCalledSupabase, [], true),
		).rejects.toThrow("writeBatch called in dry-run mode");
	});
});
