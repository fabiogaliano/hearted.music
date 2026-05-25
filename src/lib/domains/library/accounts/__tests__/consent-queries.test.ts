import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CURRENT_CONSENT_VERSION } from "@/lib/consent/consent-policy";

const mockSingle = vi.fn();
const mockUpsert = vi.fn(() => ({
	select: () => ({ single: mockSingle }),
}));

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: () => ({
		from: () => ({
			select: () => ({
				eq: () => ({ single: mockSingle }),
			}),
			upsert: mockUpsert,
		}),
	}),
}));

import {
	resolveStoredConsent,
	saveConsentPreference,
} from "../preferences-queries";

describe("resolveStoredConsent", () => {
	beforeEach(() => {
		mockSingle.mockReset();
	});

	it("resolves absent when the preferences row has no consent fields", async () => {
		mockSingle.mockResolvedValue({
			data: {
				account_id: "acct",
				consent_status: null,
				consent_updated_at: null,
				consent_version: null,
			},
			error: null,
		});

		const result = await resolveStoredConsent("acct");

		expect(Result.isOk(result)).toBe(true);
		if (Result.isOk(result)) {
			expect(result.value).toEqual({ state: "absent" });
		}
	});

	it("resolves absent when no preferences row exists at all", async () => {
		mockSingle.mockResolvedValue({
			data: null,
			error: { code: "PGRST116", message: "not found" },
		});

		const result = await resolveStoredConsent("acct");

		expect(Result.isOk(result)).toBe(true);
		if (Result.isOk(result)) {
			expect(result.value).toEqual({ state: "absent" });
		}
	});

	it("resolves valid for an in-window, current-version decision", async () => {
		mockSingle.mockResolvedValue({
			data: {
				account_id: "acct",
				consent_status: "granted",
				consent_updated_at: new Date().toISOString(),
				consent_version: CURRENT_CONSENT_VERSION,
			},
			error: null,
		});

		const result = await resolveStoredConsent("acct");

		expect(Result.isOk(result)).toBe(true);
		if (Result.isOk(result)) {
			expect(result.value).toEqual({ state: "valid", status: "granted" });
		}
	});
});

describe("saveConsentPreference", () => {
	beforeEach(() => {
		mockSingle.mockReset();
		mockUpsert.mockClear();
	});

	it("upserts the full consent triplet keyed on account_id", async () => {
		mockSingle.mockResolvedValue({
			data: { account_id: "acct" },
			error: null,
		});

		const result = await saveConsentPreference(
			"acct",
			"denied",
			CURRENT_CONSENT_VERSION,
		);

		expect(Result.isOk(result)).toBe(true);
		expect(mockUpsert).toHaveBeenCalledWith(
			expect.objectContaining({
				account_id: "acct",
				consent_status: "denied",
				consent_version: CURRENT_CONSENT_VERSION,
				consent_updated_at: expect.any(String),
			}),
			{ onConflict: "account_id" },
		);
	});
});
