import { describe, expect, it } from "vitest";
import {
	clearsSyncPhaseJobIds,
	compareOnboardingSteps,
	getNextOnboardingStep,
	getPreviousOnboardingStep,
	isOnboardingStepBefore,
	ONBOARDING_STEP_VALUES,
	SAVEABLE_ONBOARDING_STEP_VALUES,
} from "../onboarding-steps";
import { SAVEABLE_ONBOARDING_STEPS } from "../preferences-queries";

describe("compareOnboardingSteps", () => {
	it("returns negative when a comes before b", () => {
		expect(compareOnboardingSteps("welcome", "complete")).toBeLessThan(0);
	});

	it("returns 0 for equal steps", () => {
		expect(compareOnboardingSteps("claim-handle", "claim-handle")).toBe(0);
	});

	it("returns positive when a comes after b", () => {
		expect(compareOnboardingSteps("complete", "welcome")).toBeGreaterThan(0);
	});
});

describe("isOnboardingStepBefore", () => {
	it("returns true when step comes strictly before boundary", () => {
		expect(isOnboardingStepBefore("syncing", "claim-handle")).toBe(true);
		expect(isOnboardingStepBefore("welcome", "pick-color")).toBe(true);
	});

	it("returns false when step equals boundary", () => {
		expect(isOnboardingStepBefore("claim-handle", "claim-handle")).toBe(false);
	});

	it("returns false when step comes after boundary", () => {
		expect(isOnboardingStepBefore("flag-playlists", "claim-handle")).toBe(
			false,
		);
		expect(isOnboardingStepBefore("complete", "welcome")).toBe(false);
	});
});

describe("getPreviousOnboardingStep", () => {
	it("returns the step immediately before in the ordered tuple", () => {
		expect(getPreviousOnboardingStep("pick-color")).toBe("welcome");
		expect(getPreviousOnboardingStep("claim-handle")).toBe("syncing");
		expect(getPreviousOnboardingStep("complete")).toBe("plan-selection");
	});

	it("returns null for the first step", () => {
		expect(getPreviousOnboardingStep(ONBOARDING_STEP_VALUES[0])).toBeNull();
	});
});

describe("getNextOnboardingStep", () => {
	it("returns the step immediately after in the ordered tuple", () => {
		expect(getNextOnboardingStep("welcome")).toBe("pick-color");
		expect(getNextOnboardingStep("syncing")).toBe("claim-handle");
	});

	it("returns 'complete' for plan-selection", () => {
		expect(getNextOnboardingStep("plan-selection")).toBe("complete");
	});

	it("returns null for the last step", () => {
		expect(getNextOnboardingStep("complete")).toBeNull();
	});
});

describe("SAVEABLE_ONBOARDING_STEP_VALUES", () => {
	it("excludes 'complete'", () => {
		expect(SAVEABLE_ONBOARDING_STEP_VALUES).not.toContain("complete");
	});

	it("includes both walkthrough steps", () => {
		expect(SAVEABLE_ONBOARDING_STEP_VALUES).toContain("song-walkthrough");
		expect(SAVEABLE_ONBOARDING_STEP_VALUES).toContain("match-walkthrough");
	});

	it("includes claim-handle", () => {
		expect(SAVEABLE_ONBOARDING_STEP_VALUES).toContain("claim-handle");
	});
});

describe("SAVEABLE_ONBOARDING_STEPS (zod schema)", () => {
	it("fails parse on 'complete'", () => {
		expect(SAVEABLE_ONBOARDING_STEPS.safeParse("complete").success).toBe(false);
	});

	it("passes parse on 'claim-handle'", () => {
		expect(SAVEABLE_ONBOARDING_STEPS.safeParse("claim-handle").success).toBe(
			true,
		);
	});

	it("passes parse on 'plan-selection'", () => {
		expect(SAVEABLE_ONBOARDING_STEPS.safeParse("plan-selection").success).toBe(
			true,
		);
	});
});

describe("clearsSyncPhaseJobIds", () => {
	it("returns true for claim-handle (first post-sync step)", () => {
		expect(clearsSyncPhaseJobIds("claim-handle")).toBe(true);
	});

	it("returns true for all steps at and after claim-handle", () => {
		for (const step of [
			"claim-handle",
			"flag-playlists",
			"pick-demo-song",
			"song-walkthrough",
			"match-walkthrough",
			"plan-selection",
			"complete",
		] as const) {
			expect(clearsSyncPhaseJobIds(step), `expected ${step} to clear`).toBe(
				true,
			);
		}
	});

	it("returns false for all pre-sync steps", () => {
		for (const step of [
			"welcome",
			"pick-color",
			"install-extension",
			"syncing",
		] as const) {
			expect(clearsSyncPhaseJobIds(step), `expected ${step} NOT to clear`).toBe(
				false,
			);
		}
	});
});

// SQL can't import ONBOARDING_STEP_VALUES, so the claim_handle RPC hardcodes
// the "claim-handle and later" step list in its not_ready gate. This tripwire
// re-parses that list from the latest migration that (re)creates the RPC and
// fails when it drifts from the TypeScript source of truth. If this fails
// after a step change: ship a new migration re-creating claim_handle with the
// updated list.
describe("claim_handle RPC step-list tripwire", () => {
	it("matches ONBOARDING_STEP_VALUES from claim-handle onward", async () => {
		const { readdirSync, readFileSync } = await import("node:fs");
		const { join } = await import("node:path");

		const migrationsDir = join(process.cwd(), "supabase", "migrations");
		const rpcMigrations = readdirSync(migrationsDir)
			.filter((name) => name.endsWith(".sql"))
			.sort()
			.map((name) => ({
				name,
				sql: readFileSync(join(migrationsDir, name), "utf8"),
			}))
			.filter(({ sql }) => sql.includes("FUNCTION public.claim_handle"));

		expect(rpcMigrations.length).toBeGreaterThan(0);

		// Timestamped filenames sort chronologically; the last definition wins.
		const latest = rpcMigrations[rpcMigrations.length - 1];
		if (!latest) throw new Error("unreachable: length checked above");

		const notInMatch = latest.sql.match(
			/v_existing_step NOT IN \(([\s\S]*?)\)/,
		);
		if (!notInMatch?.[1]) {
			throw new Error(
				`Could not find the "v_existing_step NOT IN (...)" gate in ${latest.name}`,
			);
		}

		const sqlSteps = [...notInMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

		const claimHandleIndex = ONBOARDING_STEP_VALUES.indexOf("claim-handle");
		const expectedSteps = ONBOARDING_STEP_VALUES.slice(claimHandleIndex);

		expect(sqlSteps).toEqual(expectedSteps);
	});
});
