import { describe, expect, it, vi, beforeEach } from "vitest";
import { Result } from "better-result";

const mockSingle = vi.fn();

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: () => ({
		from: () => ({
			select: () => ({
				eq: () => ({
					single: mockSingle,
				}),
			}),
		}),
	}),
}));

import { isOnboardingComplete } from "../preferences-queries";

describe("isOnboardingComplete", () => {
	beforeEach(() => {
		mockSingle.mockReset();
	});

	it("returns false when the preferences row does not exist (first-time user)", async () => {
		mockSingle.mockResolvedValue({
			data: null,
			error: { code: "PGRST116", message: "not found" },
		});

		const result = await isOnboardingComplete("acct-new");

		expect(Result.isOk(result)).toBe(true);
		expect(Result.isOk(result) && result.value).toBe(false);
	});

	it("returns false when the row exists but onboarding_completed_at is null", async () => {
		mockSingle.mockResolvedValue({
			data: {
				account_id: "acct-mid",
				onboarding_completed_at: null,
				onboarding_step: "welcome",
				theme: null,
				phase_job_ids: null,
				demo_song_id: null,
			},
			error: null,
		});

		const result = await isOnboardingComplete("acct-mid");

		expect(Result.isOk(result)).toBe(true);
		expect(Result.isOk(result) && result.value).toBe(false);
	});

	it("returns true when onboarding_completed_at is a timestamp", async () => {
		mockSingle.mockResolvedValue({
			data: {
				account_id: "acct-done",
				onboarding_completed_at: "2026-01-15T12:00:00Z",
				onboarding_step: "complete",
				theme: "purple",
				phase_job_ids: null,
				demo_song_id: null,
			},
			error: null,
		});

		const result = await isOnboardingComplete("acct-done");

		expect(Result.isOk(result)).toBe(true);
		expect(Result.isOk(result) && result.value).toBe(true);
	});
});
