/**
 * Tests for deriveAuthPayloadFromPrefs — the pure session derivation helper.
 *
 * §14.1 coverage: handle-less pinning to claim-handle; completion-stamp
 * stays authoritative → complete.
 * §14.7 coverage: handle-less pinning over later tokens; completion-stamped
 * bypasses the pin.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminSupabaseClient } from "@/lib/data/client";
import type { UserPreferences } from "@/lib/domains/library/accounts/preferences-queries";

// Stub the DB client used inside loadWalkthroughSong.
// We pass a null demo_song_id in every test so the song-loading path is skipped.
vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: () => ({
		from: vi.fn().mockReturnValue({
			select: vi.fn().mockReturnValue({
				eq: vi.fn().mockReturnValue({
					single: vi.fn().mockResolvedValue({ data: null }),
					maybeSingle: vi.fn().mockResolvedValue({ data: null }),
					order: vi.fn().mockReturnValue({
						limit: vi.fn().mockReturnValue({
							maybeSingle: vi.fn().mockResolvedValue({ data: null }),
						}),
					}),
				}),
			}),
		}),
	}),
}));

import { deriveAuthPayloadFromPrefs } from "../onboarding-session";

// Minimal UserPreferences fixture — no demo song, no walkthrough.
function makePrefs(overrides: Partial<UserPreferences> = {}): UserPreferences {
	return {
		id: "pref-id",
		account_id: "acct-id",
		theme: null,
		onboarding_step: "claim-handle",
		onboarding_completed_at: null,
		phase_job_ids: null,
		created_at: "2026-01-01T00:00:00Z",
		updated_at: "2026-01-01T00:00:00Z",
		demo_song_id: null,
		consent_status: null,
		consent_updated_at: null,
		consent_version: null,
		...overrides,
	};
}

// Stub supabase client — not needed when demo_song_id is null (skips DB call).
const stubSupabase = null as unknown as AdminSupabaseClient;

describe("deriveAuthPayloadFromPrefs — handle-collapse and completion authority", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// §14.1 / §14.7: handle-less pinning to claim-handle
	it("pins to claim-handle when handle is null and step is after claim-handle", async () => {
		const prefs = makePrefs({ onboarding_step: "flag-playlists" });
		const payload = await deriveAuthPayloadFromPrefs({
			accountId: "acct-id",
			accountHandle: null,
			prefs,
			supabase: stubSupabase,
		});
		expect(payload.session.status).toBe("claim-handle");
	});

	it("pins to claim-handle when handle is null and step is pick-demo-song", async () => {
		const prefs = makePrefs({ onboarding_step: "pick-demo-song" });
		const payload = await deriveAuthPayloadFromPrefs({
			accountId: "acct-id",
			accountHandle: null,
			prefs,
			supabase: stubSupabase,
		});
		expect(payload.session.status).toBe("claim-handle");
	});

	it("pins to claim-handle when handle is null and step is plan-selection", async () => {
		const prefs = makePrefs({ onboarding_step: "plan-selection" });
		const payload = await deriveAuthPayloadFromPrefs({
			accountId: "acct-id",
			accountHandle: null,
			prefs,
			supabase: stubSupabase,
		});
		expect(payload.session.status).toBe("claim-handle");
	});

	// §14.1 / §14.7: completion-stamped stays complete (bypasses pin)
	it("returns complete when onboarding_completed_at is set, even if handle is null", async () => {
		const prefs = makePrefs({
			onboarding_step: "complete",
			onboarding_completed_at: "2026-01-15T12:00:00Z",
		});
		const payload = await deriveAuthPayloadFromPrefs({
			accountId: "acct-id",
			accountHandle: null,
			prefs,
			supabase: stubSupabase,
		});
		// Timestamp is the authority — null handle does NOT drag back to claim-handle
		expect(payload.session.status).toBe("complete");
	});

	// Pre-claim steps are not pinned (welcome/syncing have no handle requirement yet)
	it("does NOT pin when handle is null and step is before claim-handle (syncing)", async () => {
		const prefs = makePrefs({ onboarding_step: "syncing" });
		const payload = await deriveAuthPayloadFromPrefs({
			accountId: "acct-id",
			accountHandle: null,
			prefs,
			supabase: stubSupabase,
		});
		expect(payload.session.status).toBe("syncing");
	});

	// With a valid handle, later steps are not pinned back
	it("does NOT pin to claim-handle when handle is set and step is flag-playlists", async () => {
		const prefs = makePrefs({ onboarding_step: "flag-playlists" });
		const payload = await deriveAuthPayloadFromPrefs({
			accountId: "acct-id",
			accountHandle: "myhandle",
			prefs,
			supabase: stubSupabase,
		});
		expect(payload.session.status).toBe("flag-playlists");
	});

	// Unknown/invalid step token falls back to welcome (before claim-handle → not pinned)
	it("falls back to welcome for unknown step token (treated as pre-claim)", async () => {
		const prefs = makePrefs({ onboarding_step: "bogus-step-xyz" });
		const payload = await deriveAuthPayloadFromPrefs({
			accountId: "acct-id",
			accountHandle: null,
			prefs,
			supabase: stubSupabase,
		});
		// "bogus-step-xyz" parses to "welcome" fallback → before claim-handle → not pinned
		expect(payload.session.status).toBe("welcome");
	});
});
