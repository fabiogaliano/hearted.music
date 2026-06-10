// Three-stage tab-bound pending-return state.
//
// Stage 1 — `awaitingCreatedTab`: armed by an actual activation event (click
// or middle-auxclick) on a hearted reconnect/login link. We record `armedAtMs`
// so candidate-tab acceptance can use a *bounded* causal window — both back
// (race: tab opened before the fire-and-forget message reached the SW) and
// forward (no claim should ever happen long after the click).
//
// Stage 2 — `awaitingSpotifyNavigation`: a tab created within that bounded
// window has been adopted as a candidate. Adoption alone is NOT enough to
// fire the banner: the candidate could still be `about:blank` or could
// navigate somewhere unrelated. We wait for chrome.tabs.onUpdated on this
// exact tab to confirm it actually reaches https://open.spotify.com/.
// While the tab sits on https://accounts.spotify.com/ we keep waiting.
// Any committed navigation to a clearly-non-Spotify URL aborts the flow.
//
// Stage 3 — `awaitingToken`: the candidate tab confirmed Spotify navigation.
// The bound `spotifyTabId` is the only tab whose token transition can
// consume the pending state and trigger the banner.
//
// Pending state lives in browser.storage.session so it survives MV3 SW
// restarts. The recent-tab-creation buffer used to absorb the arm-vs-open
// race is in-memory in the service worker.

import { browser } from "../shared/browser";

export const PENDING_LOGIN_RETURN_KEY = "pendingLoginReturn";

export const AWAITING_CREATED_TAB_TTL_MS = 30_000;
export const AWAITING_SPOTIFY_NAVIGATION_TTL_MS = 10 * 60_000;
export const AWAITING_TOKEN_TTL_MS = 10 * 60_000;

// Bounded causal window for accepting a chrome.tabs.onCreated event as the
// intended candidate. Symmetric-ish: a small lookback absorbs the race where
// the new tab opens microseconds before the EXPECT_LOGIN_RETURN message
// reaches the SW; a tighter forward window prevents random later tab
// creations from being wrongly claimed.
export const ARM_BACK_SCAN_TOLERANCE_MS = 5_000;
export const ARM_FORWARD_CLAIM_WINDOW_MS = 3_000;

const SPOTIFY_OPEN_URL_PREFIX = "https://open.spotify.com/";
const SPOTIFY_ACCOUNTS_URL_PREFIX = "https://accounts.spotify.com/";

export type PendingLoginReturn =
	| {
			kind: "awaitingCreatedTab";
			originTabId: number;
			originWindowId: number;
			armedAtMs: number;
			armToken: string;
			expiresAtMs: number;
	  }
	| {
			kind: "awaitingSpotifyNavigation";
			originTabId: number;
			originWindowId: number;
			armedAtMs: number;
			armToken: string;
			candidateTabId: number;
			candidateCreatedAtMs: number;
			expiresAtMs: number;
	  }
	| {
			kind: "awaitingToken";
			originTabId: number;
			originWindowId: number;
			armToken: string;
			spotifyTabId: number;
			expiresAtMs: number;
	  };

// ── Storage primitives ────────────────────────────────────────────────────

function isPending(value: unknown): value is PendingLoginReturn {
	if (!value || typeof value !== "object") return false;
	const v = value as Record<string, unknown>;
	if (typeof v.expiresAtMs !== "number") return false;
	if (typeof v.originTabId !== "number") return false;
	if (typeof v.originWindowId !== "number") return false;
	if (typeof v.armToken !== "string" || v.armToken.length === 0) return false;
	if (v.kind === "awaitingCreatedTab") {
		return typeof v.armedAtMs === "number";
	}
	if (v.kind === "awaitingSpotifyNavigation") {
		return (
			typeof v.armedAtMs === "number" &&
			typeof v.candidateTabId === "number" &&
			typeof v.candidateCreatedAtMs === "number"
		);
	}
	if (v.kind === "awaitingToken") {
		return typeof v.spotifyTabId === "number";
	}
	return false;
}

async function readRaw(): Promise<PendingLoginReturn | null> {
	const stored = await browser.storage.session.get(PENDING_LOGIN_RETURN_KEY);
	const raw = stored[PENDING_LOGIN_RETURN_KEY];
	return isPending(raw) ? raw : null;
}

async function writeRaw(value: PendingLoginReturn): Promise<void> {
	await browser.storage.session.set({ [PENDING_LOGIN_RETURN_KEY]: value });
}

export async function clearPendingLoginReturn(): Promise<void> {
	await browser.storage.session.remove(PENDING_LOGIN_RETURN_KEY);
}

// Returns null when nothing is stored OR when the stored entry has expired.
// Expired entries are removed lazily here.
export async function getPendingLoginReturn(): Promise<PendingLoginReturn | null> {
	const raw = await readRaw();
	if (!raw) return null;
	if (Date.now() >= raw.expiresAtMs) {
		await clearPendingLoginReturn();
		return null;
	}
	return raw;
}

// ── URL helpers (pure) ───────────────────────────────────────────────────

// Best-effort destination hint. Useful for diagnostics and tests, but not for
// final navigation confirmation: pendingUrl may point at Spotify before the
// tab has actually committed there.
export function effectiveTabUrl(candidate: {
	url: string | undefined;
	pendingUrl: string | undefined;
}): string {
	return candidate.pendingUrl ?? candidate.url ?? "";
}

export type NavigationDecision = "confirm" | "wait" | "abort";

// Classifies a candidate tab's effective URL into the navigation-confirmation
// outcome:
//   - "confirm" → tab has reached a Spotify destination → bind to awaitingToken
//   - "wait"    → still on an intermediate URL (about:blank, accounts.spotify.com)
//   - "abort"   → tab committed to a clearly-non-Spotify URL → drop pending state
//
// `accounts.spotify.com` is treated as an intermediate, not a final
// confirmation, so we don't fire the banner before the user has actually
// landed inside the app.
export function classifyCandidateNavigation(url: string): NavigationDecision {
	if (url === "" || url === "about:blank") return "wait";
	if (url.startsWith(SPOTIFY_OPEN_URL_PREFIX)) return "confirm";
	if (url.startsWith(SPOTIFY_ACCOUNTS_URL_PREFIX)) return "wait";
	return "abort";
}

// Classify a full update event. Confirmation is based on the committed `url`
// only. `pendingUrl` is treated as an in-flight hint that can extend a `wait`
// state, but it must never produce `confirm` on its own.
export function classifyNavigationUpdate(update: {
	url: string | undefined;
	pendingUrl: string | undefined;
}): NavigationDecision {
	const committedDecision = classifyCandidateNavigation(update.url ?? "");
	if (committedDecision !== "abort") return committedDecision;

	if (typeof update.pendingUrl !== "string") return "abort";

	const pendingDecision = classifyCandidateNavigation(update.pendingUrl);
	return pendingDecision === "abort" ? "abort" : "wait";
}

// ── Stage 1: arm awaitingCreatedTab ───────────────────────────────────────

export type ArmAwaitingCreatedTabInput = {
	originTabId: number;
	originWindowId: number;
	armToken: string;
	ttlMs?: number;
	armedAtMs?: number;
};

export async function setPendingLoginReturnAwaitingCreatedTab({
	originTabId,
	originWindowId,
	armToken,
	ttlMs = AWAITING_CREATED_TAB_TTL_MS,
	armedAtMs = Date.now(),
}: ArmAwaitingCreatedTabInput): Promise<void> {
	const value: PendingLoginReturn = {
		kind: "awaitingCreatedTab",
		originTabId,
		originWindowId,
		armedAtMs,
		armToken,
		expiresAtMs: armedAtMs + ttlMs,
	};
	await writeRaw(value);
}

// ── Stage 2: accept a created candidate ──────────────────────────────────

export type CreatedTabCandidate = {
	tabId: number;
	windowId: number;
	openerTabId: number | undefined;
	url: string | undefined;
	pendingUrl: string | undefined;
	createdAtMs: number;
};

function hasVisibleSpotifyUrlHint(candidate: {
	url: string | undefined;
	pendingUrl: string | undefined;
}): boolean {
	const pendingUrl = candidate.pendingUrl;
	if (
		typeof pendingUrl === "string" &&
		(pendingUrl.startsWith(SPOTIFY_OPEN_URL_PREFIX) ||
			pendingUrl.startsWith(SPOTIFY_ACCOUNTS_URL_PREFIX))
	) {
		return true;
	}

	const url = candidate.url;
	return (
		typeof url === "string" &&
		(url.startsWith(SPOTIFY_OPEN_URL_PREFIX) ||
			url.startsWith(SPOTIFY_ACCOUNTS_URL_PREFIX))
	);
}

// Pure decision: should this newly-created tab be adopted as the candidate?
// Adoption is *not* a final claim — it just transitions the state machine
// to awaitingSpotifyNavigation, where chrome.tabs.onUpdated drives the rest.
//
// Rules — all required:
//   - pending state is `awaitingCreatedTab` and not expired
//   - candidate is in the same window as the originating hearted tab
//   - candidate's createdAtMs is within
//       [armedAtMs - ARM_BACK_SCAN_TOLERANCE_MS,
//        armedAtMs + ARM_FORWARD_CLAIM_WINDOW_MS]
//     This is *bounded on both sides*. Tabs created long after the click are
//     not adopted, so a delayed unrelated tab cannot hijack the flow.
//   - if openerTabId is present it must equal originTabId.
//   - the candidate must expose a Spotify host hint in url or pendingUrl.
//     Pure `about:blank` / unknown tabs are not adopted here; they can still be
//     picked up later when a tab update reveals a Spotify destination.
export function shouldAcceptCreatedCandidate(
	candidate: CreatedTabCandidate,
	pending: PendingLoginReturn,
	now: number = Date.now(),
): boolean {
	if (
		pending.kind !== "awaitingCreatedTab" &&
		pending.kind !== "awaitingSpotifyNavigation"
	) {
		return false;
	}
	if (now >= pending.expiresAtMs) return false;
	if (candidate.windowId !== pending.originWindowId) return false;

	const lowerBound = pending.armedAtMs - ARM_BACK_SCAN_TOLERANCE_MS;
	const upperBound = pending.armedAtMs + ARM_FORWARD_CLAIM_WINDOW_MS;
	if (
		candidate.createdAtMs < lowerBound ||
		candidate.createdAtMs > upperBound
	) {
		return false;
	}

	if (
		pending.kind === "awaitingSpotifyNavigation" &&
		candidate.createdAtMs <= pending.candidateCreatedAtMs
	) {
		return false;
	}

	if (
		candidate.openerTabId !== undefined &&
		candidate.openerTabId !== pending.originTabId
	) {
		return false;
	}

	if (!hasVisibleSpotifyUrlHint(candidate)) {
		return false;
	}

	return true;
}

// Atomically transition awaitingCreatedTab → awaitingSpotifyNavigation when
// `candidate` is acceptable. Returns the new state on success, null otherwise.
export async function acceptCreatedCandidate(
	candidate: CreatedTabCandidate,
): Promise<PendingLoginReturn | null> {
	const pending = await getPendingLoginReturn();
	if (!pending) return null;
	if (!shouldAcceptCreatedCandidate(candidate, pending)) return null;
	// shouldAcceptCreatedCandidate already ruled this out, but the predicate
	// returns a plain boolean so TS still sees the full union here.
	if (pending.kind === "awaitingToken") return null;

	const next: PendingLoginReturn = {
		kind: "awaitingSpotifyNavigation",
		originTabId: pending.originTabId,
		originWindowId: pending.originWindowId,
		armedAtMs: pending.armedAtMs,
		armToken: pending.armToken,
		candidateTabId: candidate.tabId,
		candidateCreatedAtMs: candidate.createdAtMs,
		expiresAtMs: Date.now() + AWAITING_SPOTIFY_NAVIGATION_TTL_MS,
	};
	await writeRaw(next);
	return next;
}

// Scan a list of recent-creation entries (collected by the SW's onCreated
// listener before/after arming) and return the most recent one that satisfies
// shouldAcceptCreatedCandidate against the *current* pending state. Returns
// null if none qualify.
export function pickAdoptableCreation(
	creations: readonly CreatedTabCandidate[],
	pending: PendingLoginReturn,
	now: number = Date.now(),
): CreatedTabCandidate | null {
	let best: CreatedTabCandidate | null = null;
	for (const c of creations) {
		if (!shouldAcceptCreatedCandidate(c, pending, now)) continue;
		if (best === null || c.createdAtMs > best.createdAtMs) best = c;
	}
	return best;
}

// ── Stage 3: confirm Spotify navigation ──────────────────────────────────

export type NavigationUpdate = {
	tabId: number;
	url: string | undefined;
	pendingUrl: string | undefined;
};

// Pure decision: given an update event for a tab, what should the state
// machine do? Returns null when the update is not relevant (wrong stage,
// wrong tab, expired, etc.).
export function shouldConfirmSpotifyNavigation(
	update: NavigationUpdate,
	pending: PendingLoginReturn,
	now: number = Date.now(),
): NavigationDecision | null {
	if (pending.kind !== "awaitingSpotifyNavigation") return null;
	if (now >= pending.expiresAtMs) return null;
	if (update.tabId !== pending.candidateTabId) return null;
	return classifyNavigationUpdate(update);
}

// Apply a navigation update to pending state. Returns:
//   - the new state when the update advanced the machine (confirm) or
//     cleared it (abort)
//   - null when the update was a no-op (wait, wrong stage, wrong tab, expiry)
export async function applyNavigationUpdate(
	update: NavigationUpdate,
): Promise<PendingLoginReturn | "cleared" | null> {
	const pending = await getPendingLoginReturn();
	if (!pending) return null;
	const decision = shouldConfirmSpotifyNavigation(update, pending);
	if (decision === null) return null;
	if (decision === "wait") return null;

	if (decision === "abort") {
		await clearPendingLoginReturn();
		return "cleared";
	}

	// confirm
	if (pending.kind !== "awaitingSpotifyNavigation") return null;
	const next: PendingLoginReturn = {
		kind: "awaitingToken",
		originTabId: pending.originTabId,
		originWindowId: pending.originWindowId,
		armToken: pending.armToken,
		spotifyTabId: pending.candidateTabId,
		expiresAtMs: Date.now() + AWAITING_TOKEN_TTL_MS,
	};
	await writeRaw(next);
	return next;
}

// ── Final consume on token transition ────────────────────────────────────

// Returns true only when pending state is `awaitingToken`, the bound
// `spotifyTabId` matches the tab whose token transition was observed, AND the
// content script for that tab has reported the same `armToken` we issued at
// arm time. Consumes (clears) the pending state on a successful match.
//
// The reported token must be supplied by the caller — the SW keeps a
// short-lived in-memory tab→armToken map (race-safe across ARM_TOKEN_PRESENT /
// SPOTIFY_TOKEN ordering) and looks it up at call time.
export async function consumePendingLoginReturnForSpotifyTab(
	spotifyTabId: number,
	reportedArmToken: string | null,
): Promise<boolean> {
	const pending = await getPendingLoginReturn();
	if (!pending) return false;
	if (pending.kind !== "awaitingToken") return false;
	if (pending.spotifyTabId !== spotifyTabId) return false;
	if (reportedArmToken === null) return false;
	if (reportedArmToken !== pending.armToken) return false;

	await clearPendingLoginReturn();
	return true;
}

// Called from chrome.tabs.onRemoved. Clears pending state if the closed tab
// is either the awaiting-navigation candidate or the bound Spotify tab.
export async function clearPendingLoginReturnIfTabClosed(
	closedTabId: number,
): Promise<void> {
	const pending = await getPendingLoginReturn();
	if (!pending) return;
	if (
		pending.kind === "awaitingSpotifyNavigation" &&
		pending.candidateTabId === closedTabId
	) {
		await clearPendingLoginReturn();
		return;
	}
	if (
		pending.kind === "awaitingToken" &&
		pending.spotifyTabId === closedTabId
	) {
		await clearPendingLoginReturn();
	}
}
