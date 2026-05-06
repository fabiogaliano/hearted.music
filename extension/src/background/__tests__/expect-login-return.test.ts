import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	ARM_BACK_SCAN_TOLERANCE_MS,
	ARM_FORWARD_CLAIM_WINDOW_MS,
	AWAITING_CREATED_TAB_TTL_MS,
	AWAITING_SPOTIFY_NAVIGATION_TTL_MS,
	AWAITING_TOKEN_TTL_MS,
	acceptCreatedCandidate,
	applyNavigationUpdate,
	type CreatedTabCandidate,
	classifyCandidateNavigation,
	classifyNavigationUpdate,
	clearPendingLoginReturn,
	clearPendingLoginReturnIfTabClosed,
	consumePendingLoginReturnForSpotifyTab,
	effectiveTabUrl,
	getPendingLoginReturn,
	PENDING_LOGIN_RETURN_KEY,
	type PendingLoginReturn,
	pickAdoptableCreation,
	setPendingLoginReturnAwaitingCreatedTab,
	shouldAcceptCreatedCandidate,
	shouldConfirmSpotifyNavigation,
} from "../expect-login-return";

type SessionStorage = {
	get: (key: string) => Promise<Record<string, unknown>>;
	set: (items: Record<string, unknown>) => Promise<void>;
	remove: (key: string) => Promise<void>;
};

function makeSessionStorage(): SessionStorage {
	const store = new Map<string, unknown>();
	return {
		get: vi.fn(async (key: string) => {
			const value = store.get(key);
			return value === undefined ? {} : { [key]: value };
		}),
		set: vi.fn(async (items: Record<string, unknown>) => {
			for (const [k, v] of Object.entries(items)) store.set(k, v);
		}),
		remove: vi.fn(async (key: string) => {
			store.delete(key);
		}),
	};
}

const globalAny = globalThis as unknown as { chrome?: unknown };

function makeCandidate(
	overrides: Partial<CreatedTabCandidate> = {},
): CreatedTabCandidate {
	return {
		tabId: 200,
		windowId: 1,
		openerTabId: 10,
		url: "about:blank",
		pendingUrl: undefined,
		createdAtMs: Date.now(),
		...overrides,
	};
}

describe("expect-login-return — 3-stage flow", () => {
	let session: SessionStorage;

	beforeEach(() => {
		session = makeSessionStorage();
		globalAny.chrome = { storage: { session } };
		vi.useRealTimers();
	});

	// ── URL helpers ─────────────────────────────────────────────────────────

	describe("effectiveTabUrl + classifyCandidateNavigation", () => {
		it("prefers pendingUrl over url (handles stale 'about:blank')", () => {
			expect(
				effectiveTabUrl({
					url: "about:blank",
					pendingUrl: "https://open.spotify.com/",
				}),
			).toBe("https://open.spotify.com/");
		});

		it("falls back to url when pendingUrl is undefined", () => {
			expect(
				effectiveTabUrl({
					url: "https://open.spotify.com/",
					pendingUrl: undefined,
				}),
			).toBe("https://open.spotify.com/");
		});

		it("classifies open.spotify.com as confirm", () => {
			expect(
				classifyCandidateNavigation("https://open.spotify.com/playlist/1"),
			).toBe("confirm");
		});

		it("classifies accounts.spotify.com as wait (intermediate, not final)", () => {
			expect(
				classifyCandidateNavigation("https://accounts.spotify.com/login"),
			).toBe("wait");
		});

		it("classifies '' and about:blank as wait", () => {
			expect(classifyCandidateNavigation("")).toBe("wait");
			expect(classifyCandidateNavigation("about:blank")).toBe("wait");
		});

		it("classifies unrelated URLs as abort", () => {
			expect(classifyCandidateNavigation("https://google.com/")).toBe("abort");
			expect(classifyCandidateNavigation("https://spotify.example.com/")).toBe(
				"abort",
			);
		});

		it("pendingUrl alone does not confirm Spotify before the committed url does", () => {
			expect(
				classifyNavigationUpdate({
					url: "about:blank",
					pendingUrl: "https://open.spotify.com/",
				}),
			).toBe("wait");
		});

		it("pending Spotify destination keeps waiting when committed url is still unrelated", () => {
			expect(
				classifyNavigationUpdate({
					url: "https://example.com/",
					pendingUrl: "https://open.spotify.com/",
				}),
			).toBe("wait");
		});
	});

	// ── Stage 1: arm awaitingCreatedTab ────────────────────────────────────

	describe("setPendingLoginReturnAwaitingCreatedTab", () => {
		it("stores origin tab/window, armedAtMs, armToken, and short TTL", async () => {
			const t0 = 1_700_000_000_000;
			await setPendingLoginReturnAwaitingCreatedTab({
				originTabId: 10,
				originWindowId: 1,
				armToken: "tok",
				armedAtMs: t0,
			});
			const stored = await session.get(PENDING_LOGIN_RETURN_KEY);
			const value = stored[PENDING_LOGIN_RETURN_KEY] as PendingLoginReturn;
			expect(value.kind).toBe("awaitingCreatedTab");
			if (value.kind !== "awaitingCreatedTab") return;
			expect(value.originTabId).toBe(10);
			expect(value.originWindowId).toBe(1);
			expect(value.armedAtMs).toBe(t0);
			expect(value.armToken).toBe("tok");
			expect(value.expiresAtMs).toBe(t0 + AWAITING_CREATED_TAB_TTL_MS);
		});

		it("constants reflect bounded windows + long credential-entry TTLs", () => {
			expect(AWAITING_CREATED_TAB_TTL_MS).toBeLessThanOrEqual(60_000);
			expect(AWAITING_SPOTIFY_NAVIGATION_TTL_MS).toBeGreaterThanOrEqual(60_000);
			expect(AWAITING_TOKEN_TTL_MS).toBeGreaterThanOrEqual(60_000);
			expect(ARM_BACK_SCAN_TOLERANCE_MS).toBeGreaterThan(0);
			expect(ARM_FORWARD_CLAIM_WINDOW_MS).toBeGreaterThan(0);
		});

		it("expired stage-1 state clears itself when read", async () => {
			await setPendingLoginReturnAwaitingCreatedTab({
				originTabId: 10,
				originWindowId: 1,
				armToken: "tok",
				ttlMs: 1,
			});
			await new Promise((r) => setTimeout(r, 5));
			expect(await getPendingLoginReturn()).toBeNull();
			const stored = await session.get(PENDING_LOGIN_RETURN_KEY);
			expect(stored[PENDING_LOGIN_RETURN_KEY]).toBeUndefined();
		});
	});

	// ── Pure rules: shouldAcceptCreatedCandidate ───────────────────────────

	describe("shouldAcceptCreatedCandidate (bounded window)", () => {
		const t0 = 1_700_000_000_000;
		const pending: PendingLoginReturn = {
			kind: "awaitingCreatedTab",
			originTabId: 10,
			originWindowId: 1,
			armedAtMs: t0,
			armToken: "tok",
			expiresAtMs: t0 + AWAITING_CREATED_TAB_TTL_MS,
		};

		it("test 4: candidate inside [armed - back, armed + forward] is accepted as candidate", () => {
			expect(
				shouldAcceptCreatedCandidate(
					makeCandidate({
						tabId: 200,
						createdAtMs: t0 + 50,
						pendingUrl: "https://open.spotify.com/",
					}),
					pending,
					t0 + 100,
				),
			).toBe(true);
		});

		it("absorbs the arm race: tab created within back-scan tolerance BEFORE arming is accepted", () => {
			expect(
				shouldAcceptCreatedCandidate(
					makeCandidate({
						tabId: 200,
						createdAtMs: t0 - (ARM_BACK_SCAN_TOLERANCE_MS - 100),
						pendingUrl: "https://open.spotify.com/",
					}),
					pending,
					t0 + 200,
				),
			).toBe(true);
		});

		it("test 6: tab created earlier than back tolerance is rejected", () => {
			expect(
				shouldAcceptCreatedCandidate(
					makeCandidate({
						tabId: 200,
						createdAtMs: t0 - ARM_BACK_SCAN_TOLERANCE_MS - 100,
					}),
					pending,
					t0,
				),
			).toBe(false);
		});

		it("test 5: tab created after the forward claim window is rejected", () => {
			expect(
				shouldAcceptCreatedCandidate(
					makeCandidate({
						tabId: 200,
						createdAtMs: t0 + ARM_FORWARD_CLAIM_WINDOW_MS + 100,
					}),
					pending,
					t0 + ARM_FORWARD_CLAIM_WINDOW_MS + 200,
				),
			).toBe(false);
		});

		it("rejects different-window candidates", () => {
			expect(
				shouldAcceptCreatedCandidate(
					makeCandidate({
						tabId: 200,
						windowId: 99,
						createdAtMs: t0 + 50,
						pendingUrl: "https://open.spotify.com/",
					}),
					pending,
					t0 + 100,
				),
			).toBe(false);
		});

		it("rejects candidates with mismatched openerTabId", () => {
			expect(
				shouldAcceptCreatedCandidate(
					makeCandidate({
						tabId: 200,
						openerTabId: 999,
						createdAtMs: t0 + 50,
						pendingUrl: "https://open.spotify.com/",
					}),
					pending,
					t0 + 100,
				),
			).toBe(false);
		});

		it("accepts noreferrer case (openerTabId undefined) on identity+timing", () => {
			expect(
				shouldAcceptCreatedCandidate(
					makeCandidate({
						tabId: 200,
						openerTabId: undefined,
						pendingUrl: "https://open.spotify.com/",
						createdAtMs: t0 + 50,
					}),
					pending,
					t0 + 100,
				),
			).toBe(true);
		});

		it("does not adopt opener-less about:blank candidates with no Spotify hint", () => {
			expect(
				shouldAcceptCreatedCandidate(
					makeCandidate({
						url: "about:blank",
						openerTabId: undefined,
						pendingUrl: undefined,
						createdAtMs: t0 + 10,
					}),
					pending,
					t0 + 100,
				),
			).toBe(false);
		});

		it("returns false for non-newer replacements once state has moved past awaitingCreatedTab", () => {
			const navStage: PendingLoginReturn = {
				kind: "awaitingSpotifyNavigation",
				originTabId: 10,
				originWindowId: 1,
				armedAtMs: t0,
				armToken: "tok",
				candidateTabId: 200,
				candidateCreatedAtMs: t0 + 100,
				expiresAtMs: t0 + 1_000_000,
			};
			expect(
				shouldAcceptCreatedCandidate(
					makeCandidate({
						tabId: 201,
						createdAtMs: t0 + 100,
						pendingUrl: "https://open.spotify.com/",
					}),
					navStage,
					t0 + 200,
				),
			).toBe(false);
		});
	});

	// ── pickAdoptableCreation back-scan ────────────────────────────────────

	describe("pickAdoptableCreation (back-scan)", () => {
		const t0 = 1_700_000_000_000;
		const pending: PendingLoginReturn = {
			kind: "awaitingCreatedTab",
			originTabId: 10,
			originWindowId: 1,
			armedAtMs: t0,
			armToken: "tok",
			expiresAtMs: t0 + 30_000,
		};

		it("returns null when no creations match", () => {
			const creations = [
				makeCandidate({ tabId: 1, windowId: 99, createdAtMs: t0 - 100 }),
			];
			expect(pickAdoptableCreation(creations, pending, t0)).toBeNull();
		});

		it("returns the most recent qualifying creation when multiple match", () => {
			const creations = [
				makeCandidate({
					tabId: 1,
					createdAtMs: t0 - 1_000,
					pendingUrl: "https://open.spotify.com/",
				}),
				makeCandidate({
					tabId: 2,
					createdAtMs: t0 - 200,
					pendingUrl: "https://open.spotify.com/",
				}),
				makeCandidate({
					tabId: 3,
					createdAtMs: t0 - 50,
					pendingUrl: "https://open.spotify.com/",
				}),
			];
			expect(pickAdoptableCreation(creations, pending, t0)?.tabId).toBe(3);
		});

		it("excludes creations outside the bounded window even if otherwise valid", () => {
			const creations = [
				makeCandidate({
					tabId: 1,
					createdAtMs: t0 - ARM_BACK_SCAN_TOLERANCE_MS - 1,
				}),
				makeCandidate({
					tabId: 2,
					createdAtMs: t0 + ARM_FORWARD_CLAIM_WINDOW_MS + 1,
				}),
			];
			expect(pickAdoptableCreation(creations, pending, t0 + 50)).toBeNull();
		});
	});

	// ── acceptCreatedCandidate transition ──────────────────────────────────

	describe("acceptCreatedCandidate", () => {
		beforeEach(async () => {
			await setPendingLoginReturnAwaitingCreatedTab({
				originTabId: 10,
				originWindowId: 1,
				armToken: "tok",
			});
		});

		it("transitions awaitingCreatedTab → awaitingSpotifyNavigation, NOT awaitingToken (test 4 / test 7 setup)", async () => {
			const next = await acceptCreatedCandidate(
				makeCandidate({
					tabId: 200,
					openerTabId: undefined,
					pendingUrl: "https://open.spotify.com/",
				}),
			);
			expect(next?.kind).toBe("awaitingSpotifyNavigation");
			if (next?.kind !== "awaitingSpotifyNavigation") return;
			expect(next.candidateTabId).toBe(200);
		});

		it("newer stronger candidates can replace an unconfirmed earlier candidate", async () => {
			await acceptCreatedCandidate(
				makeCandidate({
					tabId: 200,
					openerTabId: 10,
					pendingUrl: "https://open.spotify.com/",
				}),
			);
			const second = await acceptCreatedCandidate(
				makeCandidate({
					tabId: 201,
					createdAtMs: Date.now() + 1,
					pendingUrl: "https://open.spotify.com/",
					openerTabId: undefined,
				}),
			);
			expect(second?.kind).toBe("awaitingSpotifyNavigation");
			const state = await getPendingLoginReturn();
			if (state?.kind === "awaitingSpotifyNavigation") {
				expect(state.candidateTabId).toBe(201);
			} else {
				throw new Error("expected awaitingSpotifyNavigation");
			}
		});

		it("older or hint-less candidates do not replace the current candidate", async () => {
			await acceptCreatedCandidate(
				makeCandidate({
					tabId: 200,
					pendingUrl: "https://open.spotify.com/",
					openerTabId: undefined,
				}),
			);
			const second = await acceptCreatedCandidate(
				makeCandidate({
					tabId: 201,
					createdAtMs: Date.now() - 1,
					openerTabId: undefined,
					pendingUrl: undefined,
				}),
			);
			expect(second).toBeNull();
			const state = await getPendingLoginReturn();
			if (state?.kind === "awaitingSpotifyNavigation") {
				expect(state.candidateTabId).toBe(200);
			} else {
				throw new Error("expected awaitingSpotifyNavigation");
			}
		});

		it("rejects mismatched openerTabId", async () => {
			expect(
				await acceptCreatedCandidate(
					makeCandidate({ tabId: 200, openerTabId: 999 }),
				),
			).toBeNull();
		});

		it("returns null when no pending state exists", async () => {
			await clearPendingLoginReturn();
			expect(await acceptCreatedCandidate(makeCandidate())).toBeNull();
		});
	});

	// ── Stage 2 → 3: applyNavigationUpdate ─────────────────────────────────

	describe("applyNavigationUpdate (confirmation gate)", () => {
		beforeEach(async () => {
			await setPendingLoginReturnAwaitingCreatedTab({
				originTabId: 10,
				originWindowId: 1,
				armToken: "tok",
			});
			await acceptCreatedCandidate(
				makeCandidate({ tabId: 200, pendingUrl: "https://open.spotify.com/" }),
			);
		});

		it("test 7: about:blank candidate stays in awaitingSpotifyNavigation", async () => {
			const result = await applyNavigationUpdate({
				tabId: 200,
				url: "about:blank",
				pendingUrl: undefined,
			});
			expect(result).toBeNull();
			expect((await getPendingLoginReturn())?.kind).toBe(
				"awaitingSpotifyNavigation",
			);
		});

		it("accounts.spotify.com keeps state in awaitingSpotifyNavigation (intermediate)", async () => {
			const result = await applyNavigationUpdate({
				tabId: 200,
				url: "https://accounts.spotify.com/login",
				pendingUrl: undefined,
			});
			expect(result).toBeNull();
			expect((await getPendingLoginReturn())?.kind).toBe(
				"awaitingSpotifyNavigation",
			);
		});

		it("test 7 (continued): same tab later updates to open.spotify.com → awaitingToken", async () => {
			await applyNavigationUpdate({
				tabId: 200,
				url: "about:blank",
				pendingUrl: undefined,
			});
			const result = await applyNavigationUpdate({
				tabId: 200,
				url: "https://open.spotify.com/",
				pendingUrl: undefined,
			});
			if (!result || result === "cleared") {
				throw new Error(`expected awaitingToken state, got: ${String(result)}`);
			}
			expect(result.kind).toBe("awaitingToken");
		});

		it("pendingUrl over stale url is still only a wait, not a confirmation", async () => {
			const result = await applyNavigationUpdate({
				tabId: 200,
				url: "about:blank",
				pendingUrl: "https://open.spotify.com/",
			});
			expect(result).toBeNull();
			expect((await getPendingLoginReturn())?.kind).toBe(
				"awaitingSpotifyNavigation",
			);
		});

		it("committed Spotify url confirms immediately even if pendingUrl is absent", async () => {
			const result = await applyNavigationUpdate({
				tabId: 200,
				url: "https://open.spotify.com/",
				pendingUrl: undefined,
			});
			if (!result || result === "cleared")
				throw new Error("expected awaitingToken");
			expect(result.kind).toBe("awaitingToken");
		});

		it("test 8: candidate tab navigates to a non-Spotify URL → cleared", async () => {
			const result = await applyNavigationUpdate({
				tabId: 200,
				url: "https://google.com/",
				pendingUrl: undefined,
			});
			expect(result).toBe("cleared");
			expect(await getPendingLoginReturn()).toBeNull();
		});

		it("test 9: unrelated tab updates do NOT bind or consume", async () => {
			const result = await applyNavigationUpdate({
				tabId: 999,
				url: "https://open.spotify.com/",
				pendingUrl: undefined,
			});
			expect(result).toBeNull();
			expect((await getPendingLoginReturn())?.kind).toBe(
				"awaitingSpotifyNavigation",
			);
		});

		it("does nothing when state is awaitingCreatedTab (no candidate yet)", async () => {
			await clearPendingLoginReturn();
			await setPendingLoginReturnAwaitingCreatedTab({
				originTabId: 10,
				originWindowId: 1,
				armToken: "tok",
			});
			expect(
				await applyNavigationUpdate({
					tabId: 200,
					url: "https://open.spotify.com/",
					pendingUrl: undefined,
				}),
			).toBeNull();
		});

		it("shouldConfirmSpotifyNavigation returns null for unrelated tabs", () => {
			const pending: PendingLoginReturn = {
				kind: "awaitingSpotifyNavigation",
				originTabId: 10,
				originWindowId: 1,
				armedAtMs: Date.now(),
				armToken: "tok",
				candidateTabId: 200,
				candidateCreatedAtMs: 1,
				expiresAtMs: Date.now() + 60_000,
			};
			expect(
				shouldConfirmSpotifyNavigation(
					{
						tabId: 999,
						url: "https://open.spotify.com/",
						pendingUrl: undefined,
					},
					pending,
				),
			).toBeNull();
		});
	});

	// ── Stage 3: token consume ─────────────────────────────────────────────

	describe("consumePendingLoginReturnForSpotifyTab (dual tab + arm-token match)", () => {
		const ARM_TOKEN = "arm-token-correct";

		async function armAndConfirm(
			spotifyTabId: number,
			armToken: string = ARM_TOKEN,
		): Promise<void> {
			await setPendingLoginReturnAwaitingCreatedTab({
				originTabId: 10,
				originWindowId: 1,
				armToken,
			});
			await acceptCreatedCandidate(
				makeCandidate({
					tabId: spotifyTabId,
					pendingUrl: "https://open.spotify.com/",
				}),
			);
			await applyNavigationUpdate({
				tabId: spotifyTabId,
				url: "https://open.spotify.com/",
				pendingUrl: undefined,
			});
		}

		it("matching tab id + matching reported arm token → consumes", async () => {
			await armAndConfirm(200);
			expect(await consumePendingLoginReturnForSpotifyTab(200, ARM_TOKEN)).toBe(
				true,
			);
			expect(await getPendingLoginReturn()).toBeNull();
		});

		it("matching tab id but no reported arm token (null) → does NOT consume; pending remains", async () => {
			await armAndConfirm(200);
			expect(await consumePendingLoginReturnForSpotifyTab(200, null)).toBe(
				false,
			);
			expect((await getPendingLoginReturn())?.kind).toBe("awaitingToken");
		});

		it("matching tab id but wrong reported arm token → does NOT consume; pending remains", async () => {
			await armAndConfirm(200);
			expect(
				await consumePendingLoginReturnForSpotifyTab(200, "wrong-token"),
			).toBe(false);
			expect((await getPendingLoginReturn())?.kind).toBe("awaitingToken");
		});

		it("unrelated tab reporting the correct token → does NOT consume", async () => {
			await armAndConfirm(200);
			expect(await consumePendingLoginReturnForSpotifyTab(999, ARM_TOKEN)).toBe(
				false,
			);
			expect((await getPendingLoginReturn())?.kind).toBe("awaitingToken");
			// Subsequent legitimate dual-match still succeeds.
			expect(await consumePendingLoginReturnForSpotifyTab(200, ARM_TOKEN)).toBe(
				true,
			);
		});

		it("returns false when state is awaitingSpotifyNavigation (not yet confirmed)", async () => {
			await setPendingLoginReturnAwaitingCreatedTab({
				originTabId: 10,
				originWindowId: 1,
				armToken: ARM_TOKEN,
			});
			await acceptCreatedCandidate(
				makeCandidate({ tabId: 200, pendingUrl: "https://open.spotify.com/" }),
			);
			expect(await consumePendingLoginReturnForSpotifyTab(200, ARM_TOKEN)).toBe(
				false,
			);
			expect((await getPendingLoginReturn())?.kind).toBe(
				"awaitingSpotifyNavigation",
			);
		});

		it("ordering race: SPOTIFY_TOKEN before ARM_TOKEN_PRESENT does not consume early; later dual-match still works", async () => {
			await armAndConfirm(200);
			// Token arrives first; SW has no reported arm token yet — pass null.
			expect(await consumePendingLoginReturnForSpotifyTab(200, null)).toBe(
				false,
			);
			expect((await getPendingLoginReturn())?.kind).toBe("awaitingToken");
			// ARM_TOKEN_PRESENT arrives later; consume retried with reported token.
			expect(await consumePendingLoginReturnForSpotifyTab(200, ARM_TOKEN)).toBe(
				true,
			);
			expect(await getPendingLoginReturn()).toBeNull();
		});

		it("ordering race: ARM_TOKEN_PRESENT before SPOTIFY_TOKEN — eventual token capture consumes via stored reported token", async () => {
			await armAndConfirm(200);
			// In the SW the reported token would be persisted in the in-memory map
			// before SPOTIFY_TOKEN arrives; here we just simulate the resulting call.
			expect(await consumePendingLoginReturnForSpotifyTab(200, ARM_TOKEN)).toBe(
				true,
			);
			expect(await getPendingLoginReturn()).toBeNull();
		});

		it("test 11: long login delay still works after Spotify tab is confirmed", async () => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
			try {
				await setPendingLoginReturnAwaitingCreatedTab({
					originTabId: 10,
					originWindowId: 1,
					armToken: ARM_TOKEN,
				});
				await acceptCreatedCandidate(
					makeCandidate({
						tabId: 200,
						pendingUrl: "https://open.spotify.com/",
					}),
				);
				vi.advanceTimersByTime(2 * 60_000); // user on accounts.spotify.com 2 min
				await applyNavigationUpdate({
					tabId: 200,
					url: "https://accounts.spotify.com/login",
					pendingUrl: undefined,
				});
				vi.advanceTimersByTime(6 * 60_000); // 6 more min on login screen
				await applyNavigationUpdate({
					tabId: 200,
					url: "https://open.spotify.com/",
					pendingUrl: undefined,
				});
				vi.advanceTimersByTime(30_000); // tiny gap before token capture
				expect(
					await consumePendingLoginReturnForSpotifyTab(200, ARM_TOKEN),
				).toBe(true);
			} finally {
				vi.useRealTimers();
			}
		});
	});

	// ── Tab close cleanup ───────────────────────────────────────────────────

	describe("clearPendingLoginReturnIfTabClosed", () => {
		it("test 12a: closes during awaitingSpotifyNavigation → cleared", async () => {
			await setPendingLoginReturnAwaitingCreatedTab({
				originTabId: 10,
				originWindowId: 1,
				armToken: "tok",
			});
			await acceptCreatedCandidate(
				makeCandidate({ tabId: 200, pendingUrl: "https://open.spotify.com/" }),
			);
			await clearPendingLoginReturnIfTabClosed(200);
			expect(await getPendingLoginReturn()).toBeNull();
		});

		it("test 12b: closes during awaitingToken → cleared", async () => {
			await setPendingLoginReturnAwaitingCreatedTab({
				originTabId: 10,
				originWindowId: 1,
				armToken: "tok",
			});
			await acceptCreatedCandidate(
				makeCandidate({ tabId: 200, pendingUrl: "https://open.spotify.com/" }),
			);
			await applyNavigationUpdate({
				tabId: 200,
				url: "https://open.spotify.com/",
				pendingUrl: undefined,
			});
			await clearPendingLoginReturnIfTabClosed(200);
			expect(await getPendingLoginReturn()).toBeNull();
		});

		it("leaves state intact when an unrelated tab is closed", async () => {
			await setPendingLoginReturnAwaitingCreatedTab({
				originTabId: 10,
				originWindowId: 1,
				armToken: "tok",
			});
			await acceptCreatedCandidate(
				makeCandidate({ tabId: 200, pendingUrl: "https://open.spotify.com/" }),
			);
			await clearPendingLoginReturnIfTabClosed(999);
			expect((await getPendingLoginReturn())?.kind).toBe(
				"awaitingSpotifyNavigation",
			);
		});

		it("is a no-op while only awaitingCreatedTab is set", async () => {
			await setPendingLoginReturnAwaitingCreatedTab({
				originTabId: 10,
				originWindowId: 1,
				armToken: "tok",
			});
			await clearPendingLoginReturnIfTabClosed(123);
			expect((await getPendingLoginReturn())?.kind).toBe("awaitingCreatedTab");
		});
	});
});
