import { beforeEach, describe, expect, it } from "vite-plus/test";
import { CONSENT_COOKIE, readConsent } from "../consent-storage";

describe("readConsent", () => {
	beforeEach(() => {
		// oxlint-disable-next-line unicorn/no-document-cookie -- arranging cookie state in a test
		document.cookie = `${CONSENT_COOKIE}=; path=/; max-age=0`;
	});

	it("returns null for malformed cookie encoding instead of throwing", () => {
		// oxlint-disable-next-line unicorn/no-document-cookie -- arranging cookie state in a test
		document.cookie = `${CONSENT_COOKIE}=%E0%A4%A; path=/`;

		expect(readConsent()).toBeNull();
	});

	it("returns the stored consent status for a valid cookie", () => {
		// oxlint-disable-next-line unicorn/no-document-cookie -- arranging cookie state in a test
		document.cookie = `${CONSENT_COOKIE}=granted; path=/`;

		expect(readConsent()).toBe("granted");
	});
});
