import { describe, expect, it } from "vitest";
import {
	CURRENT_CONSENT_VERSION,
	evaluateStoredConsent,
} from "../consent-policy";

const NOW = Date.parse("2026-05-25T00:00:00Z");
const WITHIN_WINDOW = "2026-01-01T00:00:00Z"; // < 12 months before NOW
const EXPIRED = "2024-01-01T00:00:00Z"; // > 12 months before NOW

describe("evaluateStoredConsent", () => {
	it("resolves a current, in-window decision as valid", () => {
		const result = evaluateStoredConsent(
			{
				consent_status: "granted",
				consent_updated_at: WITHIN_WINDOW,
				consent_version: CURRENT_CONSENT_VERSION,
			},
			NOW,
		);

		expect(result).toEqual({ state: "valid", status: "granted" });
	});

	it("treats all-null fields as absent (never decided)", () => {
		const result = evaluateStoredConsent(
			{
				consent_status: null,
				consent_updated_at: null,
				consent_version: null,
			},
			NOW,
		);

		expect(result).toEqual({ state: "absent" });
	});

	it("treats a decision older than 12 months as stale", () => {
		const result = evaluateStoredConsent(
			{
				consent_status: "granted",
				consent_updated_at: EXPIRED,
				consent_version: CURRENT_CONSENT_VERSION,
			},
			NOW,
		);

		expect(result).toEqual({ state: "stale" });
	});

	it("treats a decision from an older policy version as stale", () => {
		const result = evaluateStoredConsent(
			{
				consent_status: "denied",
				consent_updated_at: WITHIN_WINDOW,
				consent_version: CURRENT_CONSENT_VERSION - 1,
			},
			NOW,
		);

		expect(result).toEqual({ state: "stale" });
	});

	it("treats an unrecognized status value as stale", () => {
		const result = evaluateStoredConsent(
			{
				consent_status: "maybe",
				consent_updated_at: WITHIN_WINDOW,
				consent_version: CURRENT_CONSENT_VERSION,
			},
			NOW,
		);

		expect(result).toEqual({ state: "stale" });
	});
});
