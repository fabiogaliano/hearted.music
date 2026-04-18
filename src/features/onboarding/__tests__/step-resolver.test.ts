import { describe, expect, it } from "vitest";
import type { OnboardingStep } from "@/lib/domains/library/accounts/preferences-queries";
import { isPathAllowed, resolveStep } from "../step-resolver";

describe("resolveStep", () => {
	it("maps song-walkthrough to /liked-songs with walkthrough mode", () => {
		const result = resolveStep("song-walkthrough");
		expect(result).toEqual({
			allowedPath: "/liked-songs",
			onboardingMode: "walkthrough",
		});
	});

	it("maps match-walkthrough to /match with walkthrough mode", () => {
		const result = resolveStep("match-walkthrough");
		expect(result).toEqual({
			allowedPath: "/match",
			onboardingMode: "walkthrough",
		});
	});

	const stepsOnboardingSteps: OnboardingStep[] = [
		"welcome",
		"pick-color",
		"install-extension",
		"syncing",
		"flag-playlists",
		"pick-demo-song",
		"plan-selection",
		"ready",
		"complete",
	];

	it.each(
		stepsOnboardingSteps,
	)('maps "%s" to /onboarding with steps mode', (step) => {
		const result = resolveStep(step);
		expect(result).toEqual({
			allowedPath: "/onboarding",
			onboardingMode: "steps",
		});
	});
});

describe("isPathAllowed", () => {
	it("returns true when pathname matches allowed path", () => {
		const resolved = resolveStep("song-walkthrough");
		expect(isPathAllowed("/liked-songs", resolved)).toBe(true);
	});

	it("returns false when pathname does not match allowed path", () => {
		const resolved = resolveStep("song-walkthrough");
		expect(isPathAllowed("/match", resolved)).toBe(false);
	});

	it("returns true for /match during match-walkthrough", () => {
		const resolved = resolveStep("match-walkthrough");
		expect(isPathAllowed("/match", resolved)).toBe(true);
	});

	it("returns false for /liked-songs during match-walkthrough", () => {
		const resolved = resolveStep("match-walkthrough");
		expect(isPathAllowed("/liked-songs", resolved)).toBe(false);
	});

	it("returns true for /onboarding during standard steps", () => {
		const resolved = resolveStep("welcome");
		expect(isPathAllowed("/onboarding", resolved)).toBe(true);
	});

	it("returns false for /dashboard during standard steps", () => {
		const resolved = resolveStep("welcome");
		expect(isPathAllowed("/dashboard", resolved)).toBe(false);
	});

	it("returns false for /onboarding during song-walkthrough", () => {
		const resolved = resolveStep("song-walkthrough");
		expect(isPathAllowed("/onboarding", resolved)).toBe(false);
	});
});
