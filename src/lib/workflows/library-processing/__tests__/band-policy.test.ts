import { describe, expect, it } from "vitest";
import type { BillingBand } from "../band-policy";
import { resolveEnrichmentBand, resolveRefreshBand } from "../band-policy";
import type { LibraryProcessingChange } from "../types";

const BILLING_BANDS: BillingBand[] = ["low", "standard", "priority"];

const NON_ONBOARDING_KINDS = [
	"first_match_setup_completed",
	"library_synced",
	"enrichment_completed",
	"enrichment_stopped",
	"match_snapshot_published",
	"match_snapshot_failed",
	"match_snapshot_superseded",
	"playlist_management_session_flushed",
	"enrichment_work_available",
	"songs_unlocked",
	"unlimited_activated",
	"candidate_access_revoked",
] satisfies LibraryProcessingChange["kind"][];

describe("resolveEnrichmentBand", () => {
	describe("onboarding_target_selection_confirmed always returns priority", () => {
		for (const billingBand of BILLING_BANDS) {
			it(`billingBand=${billingBand}`, () => {
				expect(
					resolveEnrichmentBand(
						billingBand,
						"onboarding_target_selection_confirmed",
					),
				).toBe("priority");
			});
		}
	});

	describe("all other change kinds pass through billingBand unchanged", () => {
		for (const kind of NON_ONBOARDING_KINDS) {
			for (const billingBand of BILLING_BANDS) {
				it(`kind=${kind} billingBand=${billingBand}`, () => {
					expect(resolveEnrichmentBand(billingBand, kind)).toBe(billingBand);
				});
			}
		}
	});
});

describe("resolveRefreshBand", () => {
	describe("isFirstVisibleBootstrap=true always returns interactive", () => {
		for (const billingBand of BILLING_BANDS) {
			it(`billingBand=${billingBand}`, () => {
				expect(
					resolveRefreshBand(billingBand, { isFirstVisibleBootstrap: true }),
				).toBe("interactive");
			});
		}
	});

	describe("isFirstVisibleBootstrap=false passes through billingBand", () => {
		for (const billingBand of BILLING_BANDS) {
			it(`billingBand=${billingBand}`, () => {
				expect(
					resolveRefreshBand(billingBand, { isFirstVisibleBootstrap: false }),
				).toBe(billingBand);
			});
		}
	});
});
