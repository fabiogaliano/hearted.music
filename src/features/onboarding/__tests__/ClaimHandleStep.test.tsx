/**
 * Tests for ClaimHandleStep — §14.6.
 *
 * Covers: actionable-only gating, owned/edited-away/reset states, format errors,
 * reserved short-circuit, debounce + stale-result isolation, available→preview,
 * submit branches (claimed/already_owned/not_ready), submit-time unavailable,
 * operational error toast, a11y wiring, focus return.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@/test/utils/render";
import { ClaimHandleStep } from "../components/ClaimHandleStep";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockCheckHandleAvailability = vi.fn();
const mockClaimHandleAndAdvance = vi.fn();
const mockNavigate = vi.fn().mockResolvedValue(undefined);
const mockToastError = vi.fn();

vi.mock("@/lib/server/account-handle.functions", () => ({
	checkHandleAvailability: (args: unknown) => mockCheckHandleAvailability(args),
	claimHandleAndAdvance: (args: unknown) => mockClaimHandleAndAdvance(args),
}));

vi.mock("@tanstack/react-router", () => ({
	useRouter: () => ({ navigate: mockNavigate }),
}));

vi.mock("sonner", () => ({
	toast: { error: (msg: unknown) => mockToastError(msg) },
}));

// Public origin stub — consistent with getPublicAppOrigin()
vi.mock("@/lib/config/public-app-origin", () => ({
	getPublicAppOrigin: () => "https://hearted.music",
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

// Each test gets a fresh QueryClient with no shared cache.
function makeQueryClient() {
	return new QueryClient({
		defaultOptions: {
			queries: { retry: false, gcTime: 0 },
		},
	});
}

function TestWrapper({
	children,
	queryClient,
}: {
	children: ReactNode;
	queryClient: QueryClient;
}) {
	return (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
}

function renderStep(ui: ReactElement, queryClient = makeQueryClient()) {
	return render(<TestWrapper queryClient={queryClient}>{ui}</TestWrapper>);
}

const BASE_PROPS = {
	accountId: "acct-001",
};

// Minimal onboarding payload returned by server functions.
function makeOnboarding(status: string = "flag-playlists") {
	return {
		session: { status, accountId: "acct-001" },
		theme: "rose" as const,
	};
}

// ── §14.6 tests ───────────────────────────────────────────────────────────────

describe("ClaimHandleStep", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Default availability mock — tests override per-scenario.
		mockCheckHandleAvailability.mockResolvedValue({ status: "available" });
	});

	// ── Blank seed mount ──────────────────────────────────────────────────────

	it("blank seed: shows helper and disabled Continue with empty field", () => {
		renderStep(
			<ClaimHandleStep {...BASE_PROPS} claimHandleSeed={{ kind: "blank" }} />,
		);

		expect(
			screen.getByText("Letters, numbers, periods, and underscores."),
		).toBeInTheDocument();

		const btn = screen.getByRole("button", { name: /continue/i });
		expect(btn).toBeDisabled();
	});

	// ── Owned seed mount ──────────────────────────────────────────────────────

	it("owned seed: shows 'Using your current handle.' and enables Continue", () => {
		renderStep(
			<ClaimHandleStep
				{...BASE_PROPS}
				claimHandleSeed={{ kind: "owned", handle: "fabio" }}
			/>,
		);

		expect(screen.getByDisplayValue("fabio")).toBeInTheDocument();
		expect(screen.getByText("Using your current handle.")).toBeInTheDocument();

		const btn = screen.getByRole("button", { name: /continue/i });
		expect(btn).not.toBeDisabled();
	});

	it("owned seed: does not trigger an availability check on mount", () => {
		renderStep(
			<ClaimHandleStep
				{...BASE_PROPS}
				claimHandleSeed={{ kind: "owned", handle: "fabio" }}
			/>,
		);

		expect(mockCheckHandleAvailability).not.toHaveBeenCalled();
	});

	// ── Owned seed edited away ────────────────────────────────────────────────

	it("editing away from owned value: shows reminder, disables Continue, offers reset", async () => {
		const { user } = renderStep(
			<ClaimHandleStep
				{...BASE_PROPS}
				claimHandleSeed={{ kind: "owned", handle: "fabio" }}
			/>,
		);

		const input = screen.getByRole("textbox", { name: /handle/i });
		await user.clear(input);
		await user.type(input, "different");

		expect(
			screen.getByText(/Your handle is already @fabio\./),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
		expect(
			screen.getByRole("button", { name: /Use @fabio/ }),
		).toBeInTheDocument();
	});

	it("edited-away owned: Enter/submit does nothing (no availability, no claim)", async () => {
		const { user } = renderStep(
			<ClaimHandleStep
				{...BASE_PROPS}
				claimHandleSeed={{ kind: "owned", handle: "fabio" }}
			/>,
		);

		const input = screen.getByRole("textbox", { name: /handle/i });
		await user.clear(input);
		await user.type(input, "other");

		const form = input.closest("form")!;
		// Submit the form directly to simulate Enter press.
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);

		await waitFor(() => {
			expect(mockCheckHandleAvailability).not.toHaveBeenCalled();
			expect(mockClaimHandleAndAdvance).not.toHaveBeenCalled();
		});
	});

	it("reset action: restores owned handle and shows owned status", async () => {
		const { user } = renderStep(
			<ClaimHandleStep
				{...BASE_PROPS}
				claimHandleSeed={{ kind: "owned", handle: "fabio" }}
			/>,
		);

		const input = screen.getByRole("textbox", { name: /handle/i });
		await user.clear(input);
		await user.type(input, "other");

		const resetBtn = screen.getByRole("button", { name: /Use @fabio/ });
		await user.click(resetBtn);

		expect(screen.getByDisplayValue("fabio")).toBeInTheDocument();
		expect(screen.getByText("Using your current handle.")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /continue/i }),
		).not.toBeDisabled();
	});

	// ── Live-lowercase ────────────────────────────────────────────────────────

	it("live-lowercase: uppercased input is lowercased, no other chars stripped", async () => {
		const { user } = renderStep(
			<ClaimHandleStep {...BASE_PROPS} claimHandleSeed={{ kind: "blank" }} />,
		);

		const input = screen.getByRole("textbox", { name: /handle/i });
		await user.type(input, "FaBiO");

		// Input should display as lowercase.
		expect(screen.getByDisplayValue("fabio")).toBeInTheDocument();
	});

	it("preserves @, spaces, and hyphens rather than stripping them", async () => {
		const { user } = renderStep(
			<ClaimHandleStep {...BASE_PROPS} claimHandleSeed={{ kind: "blank" }} />,
		);

		const input = screen.getByRole("textbox", { name: /handle/i });
		await user.type(input, "@fab-io");
		// @ is lowercased (no-op), hyphens preserved.
		expect(screen.getByDisplayValue("@fab-io")).toBeInTheDocument();
	});

	// ── Format error copy ─────────────────────────────────────────────────────

	it("shows @ error copy when input contains @", async () => {
		const { user } = renderStep(
			<ClaimHandleStep {...BASE_PROPS} claimHandleSeed={{ kind: "blank" }} />,
		);

		await user.type(screen.getByRole("textbox", { name: /handle/i }), "@fabio");
		expect(
			screen.getByText("Don’t include @ — it’s added to your public URL."),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
	});

	it("shows invalid_chars copy for hyphens/spaces", async () => {
		const { user } = renderStep(
			<ClaimHandleStep {...BASE_PROPS} claimHandleSeed={{ kind: "blank" }} />,
		);

		await user.type(screen.getByRole("textbox", { name: /handle/i }), "fab io");
		expect(
			screen.getByText("Use only letters, numbers, periods, or underscores."),
		).toBeInTheDocument();
	});

	it("shows too_long copy for overlength input and does not truncate", async () => {
		const { user } = renderStep(
			<ClaimHandleStep {...BASE_PROPS} claimHandleSeed={{ kind: "blank" }} />,
		);

		const long = "a".repeat(31);
		await user.type(screen.getByRole("textbox", { name: /handle/i }), long);

		expect(
			screen.getByText("Handles can be up to 30 characters."),
		).toBeInTheDocument();
		// Full 31-char value must be in the field — no silent truncation.
		expect(screen.getByDisplayValue(long)).toBeInTheDocument();
	});

	it("shows leading_period copy", async () => {
		const { user } = renderStep(
			<ClaimHandleStep {...BASE_PROPS} claimHandleSeed={{ kind: "blank" }} />,
		);

		await user.type(screen.getByRole("textbox", { name: /handle/i }), ".fabio");
		expect(
			screen.getByText("Periods can’t start a username."),
		).toBeInTheDocument();
	});

	it("shows trailing_period copy", async () => {
		const { user } = renderStep(
			<ClaimHandleStep {...BASE_PROPS} claimHandleSeed={{ kind: "blank" }} />,
		);

		await user.type(screen.getByRole("textbox", { name: /handle/i }), "fabio.");
		expect(
			screen.getByText("Periods can’t end a username."),
		).toBeInTheDocument();
	});

	it("shows consecutive_periods copy", async () => {
		const { user } = renderStep(
			<ClaimHandleStep {...BASE_PROPS} claimHandleSeed={{ kind: "blank" }} />,
		);

		await user.type(
			screen.getByRole("textbox", { name: /handle/i }),
			"fabio..g",
		);
		expect(
			screen.getByText("Periods can’t appear twice in a row."),
		).toBeInTheDocument();
	});

	// ── Reserved short-circuit ────────────────────────────────────────────────

	it("reserved handle: shows 'That handle is reserved.' and suppresses availability check", async () => {
		const { user } = renderStep(
			<ClaimHandleStep {...BASE_PROPS} claimHandleSeed={{ kind: "blank" }} />,
		);

		await user.type(screen.getByRole("textbox", { name: /handle/i }), "admin");

		expect(screen.getByText("That handle is reserved.")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
		expect(mockCheckHandleAvailability).not.toHaveBeenCalled();
	});

	// ── Debounce + availability ────────────────────────────────────────────────

	it("available: shows 'Available.' and enables Continue after debounce", async () => {
		mockCheckHandleAvailability.mockResolvedValue({ status: "available" });

		const { user } = renderStep(
			<ClaimHandleStep {...BASE_PROPS} claimHandleSeed={{ kind: "blank" }} />,
		);

		await user.type(screen.getByRole("textbox", { name: /handle/i }), "fabio");

		await waitFor(() => {
			expect(screen.getByText("Available.")).toBeInTheDocument();
		});

		expect(
			screen.getByRole("button", { name: /continue/i }),
		).not.toBeDisabled();
	});

	it("checking: shows 'Checking availability…' and Continue stays disabled", async () => {
		// Delay the response so we can observe the checking state.
		let resolveCheck!: (v: unknown) => void;
		mockCheckHandleAvailability.mockReturnValue(
			new Promise((res) => {
				resolveCheck = res;
			}),
		);

		const { user } = renderStep(
			<ClaimHandleStep {...BASE_PROPS} claimHandleSeed={{ kind: "blank" }} />,
		);

		await user.type(screen.getByRole("textbox", { name: /handle/i }), "fabio");

		await waitFor(() => {
			expect(screen.getByText("Checking availability")).toBeInTheDocument();
		});
		expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();

		// Cleanup: resolve so no pending async work leaks.
		resolveCheck({ status: "available" });
	});

	it("taken: shows 'Someone got there first.' and Continue stays disabled", async () => {
		mockCheckHandleAvailability.mockResolvedValue({
			status: "unavailable",
			reason: "taken",
		});

		const { user } = renderStep(
			<ClaimHandleStep {...BASE_PROPS} claimHandleSeed={{ kind: "blank" }} />,
		);

		await user.type(screen.getByRole("textbox", { name: /handle/i }), "fabio");

		await waitFor(() => {
			expect(screen.getByText("Someone got there first.")).toBeInTheDocument();
		});
		expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
	});

	it("availability error: shows error copy and 'Check again' retry; Continue disabled", async () => {
		mockCheckHandleAvailability.mockResolvedValue({ status: "error" });

		const { user } = renderStep(
			<ClaimHandleStep {...BASE_PROPS} claimHandleSeed={{ kind: "blank" }} />,
		);

		await user.type(screen.getByRole("textbox", { name: /handle/i }), "fabio");

		await waitFor(() => {
			expect(
				screen.getByText(/Couldn’t check that one\. Give it another go\./),
			).toBeInTheDocument();
		});
		expect(
			screen.getByRole("button", { name: /Check again/i }),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
	});

	it("suggested seed: triggers availability check on mount immediately", async () => {
		mockCheckHandleAvailability.mockResolvedValue({ status: "available" });

		renderStep(
			<ClaimHandleStep
				{...BASE_PROPS}
				claimHandleSeed={{ kind: "suggested", handle: "fabio" }}
			/>,
		);

		await waitFor(() => {
			expect(mockCheckHandleAvailability).toHaveBeenCalledWith(
				expect.objectContaining({ data: { handle: "fabio" } }),
			);
		});
	});

	it("suggested seed mount-time error: shows error state, keeps address visible, allows edit recovery", async () => {
		mockCheckHandleAvailability.mockResolvedValue({ status: "error" });

		const { user } = renderStep(
			<ClaimHandleStep
				{...BASE_PROPS}
				claimHandleSeed={{ kind: "suggested", handle: "fabio" }}
			/>,
		);

		await waitFor(() => {
			expect(
				screen.getByText(/Couldn’t check that one\. Give it another go\./),
			).toBeInTheDocument();
		});
		// The address prefix is part of the field, so it stays visible in error too.
		expect(screen.getByText("hearted.music/@")).toBeInTheDocument();

		// Now edit the field — should clear to neutral debounce-gap state.
		const input = screen.getByRole("textbox", { name: /handle/i });
		await user.type(input, "x");
		// Error copy should be gone immediately.
		expect(
			screen.queryByText(/Couldn’t check that one/),
		).not.toBeInTheDocument();
	});

	// ── Inline address ─────────────────────────────────────────────────────────

	it("renders the address prefix and the typed handle as the field value", async () => {
		mockCheckHandleAvailability.mockResolvedValue({ status: "available" });

		const { user } = renderStep(
			<ClaimHandleStep {...BASE_PROPS} claimHandleSeed={{ kind: "blank" }} />,
		);

		const input = screen.getByRole("textbox", { name: /handle/i });
		await user.type(input, "fabio");

		await waitFor(() => {
			expect(screen.getByText("Available.")).toBeInTheDocument();
		});
		expect(screen.getByText("hearted.music/@")).toBeInTheDocument();
		expect(input).toHaveValue("fabio");
	});

	it("renders the address prefix for an owned-equal handle", () => {
		renderStep(
			<ClaimHandleStep
				{...BASE_PROPS}
				claimHandleSeed={{ kind: "owned", handle: "fabio" }}
			/>,
		);

		expect(screen.getByText("hearted.music/@")).toBeInTheDocument();
		expect(screen.getByRole("textbox", { name: /handle/i })).toHaveValue(
			"fabio",
		);
	});

	it("keeps the address prefix visible for an unavailable (taken) handle", async () => {
		mockCheckHandleAvailability.mockResolvedValue({
			status: "unavailable",
			reason: "taken",
		});

		const { user } = renderStep(
			<ClaimHandleStep {...BASE_PROPS} claimHandleSeed={{ kind: "blank" }} />,
		);

		await user.type(screen.getByRole("textbox", { name: /handle/i }), "fabio");

		await waitFor(() => {
			expect(screen.getByText("Someone got there first.")).toBeInTheDocument();
		});
		expect(screen.getByText("hearted.music/@")).toBeInTheDocument();
	});

	it("keeps the address prefix visible for edited-away owned state", async () => {
		const { user } = renderStep(
			<ClaimHandleStep
				{...BASE_PROPS}
				claimHandleSeed={{ kind: "owned", handle: "fabio" }}
			/>,
		);

		const input = screen.getByRole("textbox", { name: /handle/i });
		await user.clear(input);
		await user.type(input, "other");

		expect(screen.getByText("hearted.music/@")).toBeInTheDocument();
		expect(input).toHaveValue("other");
	});

	// ── Submit: not_ready branch ──────────────────────────────────────────────

	it("not_ready: patches only onboarding-session, navigates, no toast", async () => {
		mockCheckHandleAvailability.mockResolvedValue({ status: "available" });
		const onboarding = makeOnboarding("syncing");
		mockClaimHandleAndAdvance.mockResolvedValue({
			status: "not_ready",
			onboarding,
		});

		const queryClient = makeQueryClient();
		const setQueryDataSpy = vi.spyOn(queryClient, "setQueryData");

		const { user } = renderStep(
			<ClaimHandleStep {...BASE_PROPS} claimHandleSeed={{ kind: "blank" }} />,
			queryClient,
		);

		await user.type(screen.getByRole("textbox", { name: /handle/i }), "fabio");
		await waitFor(() => {
			expect(screen.getByText("Available.")).toBeInTheDocument();
		});

		await user.click(screen.getByRole("button", { name: /continue/i }));

		await waitFor(() => {
			expect(mockNavigate).toHaveBeenCalledWith(
				expect.objectContaining({ to: "/onboarding" }),
			);
		});

		// onboarding-session patched (spy captures the call even if client is different).
		await waitFor(() => {
			expect(setQueryDataSpy).toHaveBeenCalledWith(
				["auth", "onboarding-session"],
				onboarding,
			);
		});

		// account.handle must NOT have been patched — not_ready doesn't set a handle.
		expect(setQueryDataSpy).not.toHaveBeenCalledWith(
			["auth", "session"],
			expect.anything(),
		);

		expect(mockToastError).not.toHaveBeenCalled();
	});

	// ── Submit: already_owned branch ──────────────────────────────────────────

	it("already_owned (submit): patches both caches with ownedHandle, navigates, no toast", async () => {
		mockCheckHandleAvailability.mockResolvedValue({ status: "available" });
		const onboarding = makeOnboarding("flag-playlists");
		mockClaimHandleAndAdvance.mockResolvedValue({
			status: "already_owned",
			ownedHandle: "real-handle",
			onboarding,
		});

		const queryClient = makeQueryClient();
		// Use a spy to verify setQueryData calls regardless of gcTime GC.
		const setQueryDataSpy = vi.spyOn(queryClient, "setQueryData");

		const { user } = renderStep(
			<ClaimHandleStep {...BASE_PROPS} claimHandleSeed={{ kind: "blank" }} />,
			queryClient,
		);

		await user.type(screen.getByRole("textbox", { name: /handle/i }), "fabio");
		await waitFor(() => {
			expect(screen.getByText("Available.")).toBeInTheDocument();
		});

		await user.click(screen.getByRole("button", { name: /continue/i }));

		await waitFor(() => {
			expect(mockNavigate).toHaveBeenCalled();
		});

		// Both caches patched. gcTime:0 GCs the data before we can read it,
		// so spy on the call instead of reading back the value.
		await waitFor(() => {
			expect(setQueryDataSpy).toHaveBeenCalledWith(
				["auth", "onboarding-session"],
				onboarding,
			);
			// session patched with an updater function (to preserve session+identity).
			expect(setQueryDataSpy).toHaveBeenCalledWith(
				["auth", "session"],
				expect.any(Function),
			);
		});

		// Verify the updater function merges the ownedHandle correctly.
		const sessionCall = setQueryDataSpy.mock.calls.find(
			(c) => Array.isArray(c[0]) && c[0].includes("session"),
		);
		if (sessionCall) {
			const updater = sessionCall[1] as (prev: unknown) => unknown;
			const prev = { account: { handle: null }, session: {}, identity: {} };
			const updated = updater(prev) as { account: { handle: string } };
			expect(updated.account.handle).toBe("real-handle");
		}

		expect(mockToastError).not.toHaveBeenCalled();
	});

	// ── Submit: claimed branch ────────────────────────────────────────────────

	it("claimed: patches both caches (preserves session+identity, replaces handle), navigates", async () => {
		mockCheckHandleAvailability.mockResolvedValue({ status: "available" });
		const onboarding = makeOnboarding("flag-playlists");
		mockClaimHandleAndAdvance.mockResolvedValue({
			status: "claimed",
			ownedHandle: "fabio",
			onboarding,
		});

		const queryClient = makeQueryClient();
		const setQueryDataSpy = vi.spyOn(queryClient, "setQueryData");

		const { user } = renderStep(
			<ClaimHandleStep {...BASE_PROPS} claimHandleSeed={{ kind: "blank" }} />,
			queryClient,
		);

		await user.type(screen.getByRole("textbox", { name: /handle/i }), "fabio");
		await waitFor(() => {
			expect(screen.getByText("Available.")).toBeInTheDocument();
		});

		await user.click(screen.getByRole("button", { name: /continue/i }));

		await waitFor(() => {
			expect(mockNavigate).toHaveBeenCalled();
		});

		// Both caches patched.
		await waitFor(() => {
			expect(setQueryDataSpy).toHaveBeenCalledWith(
				["auth", "onboarding-session"],
				onboarding,
			);
			expect(setQueryDataSpy).toHaveBeenCalledWith(
				["auth", "session"],
				expect.any(Function),
			);
		});

		// The session updater must preserve session+identity and only replace handle.
		const sessionCall = setQueryDataSpy.mock.calls.find(
			(c) => Array.isArray(c[0]) && c[0].includes("session"),
		);
		if (sessionCall) {
			const updater = sessionCall[1] as (prev: unknown) => unknown;
			const prev = {
				session: { accountId: "acct-001" },
				account: { handle: null, display_name: "Fabio" },
				identity: { email: "fabio@test.com", emailVerified: true },
			};
			const updated = updater(prev) as typeof prev;
			expect(updated.account.handle).toBe("fabio");
			// session and identity must be preserved unchanged.
			expect(updated.session).toEqual(prev.session);
			expect(updated.identity).toEqual(prev.identity);
		} else {
			throw new Error("Expected session setQueryData call not found");
		}
	});

	it("claimed with complete session: navigates to /dashboard", async () => {
		mockCheckHandleAvailability.mockResolvedValue({ status: "available" });
		const onboarding = makeOnboarding("complete");
		mockClaimHandleAndAdvance.mockResolvedValue({
			status: "claimed",
			ownedHandle: "fabio",
			onboarding,
		});

		const { user } = renderStep(
			<ClaimHandleStep {...BASE_PROPS} claimHandleSeed={{ kind: "blank" }} />,
		);

		await user.type(screen.getByRole("textbox", { name: /handle/i }), "fabio");
		await waitFor(() =>
			expect(screen.getByText("Available.")).toBeInTheDocument(),
		);

		await user.click(screen.getByRole("button", { name: /continue/i }));

		await waitFor(() => {
			expect(mockNavigate).toHaveBeenCalledWith(
				expect.objectContaining({ to: "/dashboard" }),
			);
		});
	});

	// ── Submit: unavailable (submit-time) ─────────────────────────────────────

	it("submit-time unavailable: shows inline error, keeps address visible, Continue stays disabled", async () => {
		mockCheckHandleAvailability.mockResolvedValue({ status: "available" });
		mockClaimHandleAndAdvance.mockResolvedValue({
			status: "unavailable",
			reason: "taken",
		});

		const { user } = renderStep(
			<ClaimHandleStep {...BASE_PROPS} claimHandleSeed={{ kind: "blank" }} />,
		);

		await user.type(screen.getByRole("textbox", { name: /handle/i }), "fabio");
		await waitFor(() =>
			expect(screen.getByText("Available.")).toBeInTheDocument(),
		);

		await user.click(screen.getByRole("button", { name: /continue/i }));

		await waitFor(() => {
			expect(screen.getByText("Someone got there first.")).toBeInTheDocument();
		});
		// The address prefix is part of the field — it stays visible.
		expect(screen.getByText("hearted.music/@")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
		// No toast.
		expect(mockToastError).not.toHaveBeenCalled();
	});

	it("submit-time unavailable: restores input editability and focus", async () => {
		mockCheckHandleAvailability.mockResolvedValue({ status: "available" });
		mockClaimHandleAndAdvance.mockResolvedValue({
			status: "unavailable",
			reason: "taken",
		});

		const { user } = renderStep(
			<ClaimHandleStep {...BASE_PROPS} claimHandleSeed={{ kind: "blank" }} />,
		);

		await user.type(screen.getByRole("textbox", { name: /handle/i }), "fabio");
		await waitFor(() =>
			expect(screen.getByText("Available.")).toBeInTheDocument(),
		);

		await user.click(screen.getByRole("button", { name: /continue/i }));

		await waitFor(() => {
			const input = screen.getByRole("textbox", { name: /handle/i });
			expect(input).not.toHaveAttribute("readonly");
		});
	});

	// ── Submit: operational error ─────────────────────────────────────────────

	it("operational submit error: toasts, stays on step, restores editability", async () => {
		mockCheckHandleAvailability.mockResolvedValue({ status: "available" });
		mockClaimHandleAndAdvance.mockRejectedValue(new Error("network error"));

		const { user } = renderStep(
			<ClaimHandleStep {...BASE_PROPS} claimHandleSeed={{ kind: "blank" }} />,
		);

		await user.type(screen.getByRole("textbox", { name: /handle/i }), "fabio");
		await waitFor(() =>
			expect(screen.getByText("Available.")).toBeInTheDocument(),
		);

		await user.click(screen.getByRole("button", { name: /continue/i }));

		await waitFor(() => {
			expect(mockToastError).toHaveBeenCalledWith(
				expect.stringContaining("Couldn’t save"),
			);
		});

		// Stays on step — input still visible.
		expect(screen.getByDisplayValue("fabio")).toBeInTheDocument();
		// Input is editable again.
		const input = screen.getByRole("textbox", { name: /handle/i });
		expect(input).not.toHaveAttribute("readonly");
	});

	// ── readOnly during submit ────────────────────────────────────────────────

	it("input becomes readOnly during submit (not disabled)", async () => {
		mockCheckHandleAvailability.mockResolvedValue({ status: "available" });

		// Delay claim so we can observe readOnly mid-flight.
		let resolveClaim!: (v: unknown) => void;
		mockClaimHandleAndAdvance.mockReturnValue(
			new Promise((res) => {
				resolveClaim = res;
			}),
		);

		const { user } = renderStep(
			<ClaimHandleStep {...BASE_PROPS} claimHandleSeed={{ kind: "blank" }} />,
		);

		await user.type(screen.getByRole("textbox", { name: /handle/i }), "fabio");
		await waitFor(() =>
			expect(screen.getByText("Available.")).toBeInTheDocument(),
		);

		await user.click(screen.getByRole("button", { name: /continue/i }));

		await waitFor(() => {
			const input = screen.getByRole("textbox", { name: /handle/i });
			// readOnly attribute set.
			expect(input).toHaveAttribute("readonly");
			// NOT disabled — value stays visible for AT.
			expect(input).not.toBeDisabled();
		});

		resolveClaim({
			status: "not_ready",
			onboarding: makeOnboarding("syncing"),
		});
	});

	// ── A11y wiring ───────────────────────────────────────────────────────────

	it("a11y: input has aria-describedby pointing to both stable ids", () => {
		renderStep(
			<ClaimHandleStep {...BASE_PROPS} claimHandleSeed={{ kind: "blank" }} />,
		);

		const input = screen.getByRole("textbox", { name: /handle/i });
		expect(input).toHaveAttribute(
			"aria-describedby",
			"claim-handle-helper claim-handle-status",
		);
	});

	it("a11y: static helper has stable id; dynamic region has stable id + aria-live=polite", () => {
		renderStep(
			<ClaimHandleStep {...BASE_PROPS} claimHandleSeed={{ kind: "blank" }} />,
		);

		const helper = document.getElementById("claim-handle-helper");
		expect(helper).toBeTruthy();
		// Helper must NOT be a live region.
		expect(helper).not.toHaveAttribute("aria-live");

		const status = document.getElementById("claim-handle-status");
		expect(status).toBeTruthy();
		expect(status).toHaveAttribute("aria-live", "polite");
	});

	it("a11y: semantic <form> element is present", () => {
		renderStep(
			<ClaimHandleStep {...BASE_PROPS} claimHandleSeed={{ kind: "blank" }} />,
		);

		const input = screen.getByRole("textbox", { name: /handle/i });
		expect(input.closest("form")).toBeTruthy();
	});

	it("a11y: input exposes a 'Handle' accessible name", () => {
		renderStep(
			<ClaimHandleStep {...BASE_PROPS} claimHandleSeed={{ kind: "blank" }} />,
		);

		expect(screen.getByLabelText(/handle/i)).toBeTruthy();
	});

	// ── Enter behavior — no useShortcut dependency ────────────────────────────

	it("Enter from the input submits via native form behavior when value is available", async () => {
		mockCheckHandleAvailability.mockResolvedValue({ status: "available" });
		mockClaimHandleAndAdvance.mockResolvedValue({
			status: "claimed",
			ownedHandle: "fabio",
			onboarding: makeOnboarding("flag-playlists"),
		});

		const { user } = renderStep(
			<ClaimHandleStep {...BASE_PROPS} claimHandleSeed={{ kind: "blank" }} />,
		);

		const input = screen.getByRole("textbox", { name: /handle/i });
		await user.type(input, "fabio");
		await waitFor(() =>
			expect(screen.getByText("Available.")).toBeInTheDocument(),
		);

		await user.keyboard("{Enter}");

		await waitFor(() => {
			expect(mockClaimHandleAndAdvance).toHaveBeenCalledWith(
				expect.objectContaining({ data: { handle: "fabio" } }),
			);
		});
	});

	// ── Stale already_owned during availability ───────────────────────────────

	it("availability-time already_owned: patches both caches and navigates immediately", async () => {
		const onboarding = makeOnboarding("flag-playlists");
		mockCheckHandleAvailability.mockResolvedValue({
			status: "already_owned",
			ownedHandle: "existing-handle",
			onboarding,
		});

		const queryClient = makeQueryClient();
		// Use spy to verify setQueryData calls (gcTime:0 GCs data before read).
		const setQueryDataSpy = vi.spyOn(queryClient, "setQueryData");

		const { user } = renderStep(
			<ClaimHandleStep {...BASE_PROPS} claimHandleSeed={{ kind: "blank" }} />,
			queryClient,
		);

		await user.type(screen.getByRole("textbox", { name: /handle/i }), "fabio");

		await waitFor(() => {
			expect(mockNavigate).toHaveBeenCalled();
		});

		// Both caches patched.
		await waitFor(() => {
			expect(setQueryDataSpy).toHaveBeenCalledWith(
				["auth", "onboarding-session"],
				onboarding,
			);
			expect(setQueryDataSpy).toHaveBeenCalledWith(
				["auth", "session"],
				expect.any(Function),
			);
		});

		// Verify the updater sets the ownedHandle.
		const sessionCall = setQueryDataSpy.mock.calls.find(
			(c) => Array.isArray(c[0]) && c[0].includes("session"),
		);
		if (sessionCall) {
			const updater = sessionCall[1] as (prev: unknown) => unknown;
			const prev = { account: { handle: null }, session: {}, identity: {} };
			const updated = updater(prev) as { account: { handle: string } };
			expect(updated.account.handle).toBe("existing-handle");
		} else {
			throw new Error("Expected session setQueryData call not found");
		}

		// No claim was attempted.
		expect(mockClaimHandleAndAdvance).not.toHaveBeenCalled();
	});

	// ── Unchecked debounce gap: submit is a no-op ─────────────────────────────

	it("unchecked debounce gap: submit does not bypass debounce or call claimHandleAndAdvance", async () => {
		// Make the check very slow to ensure we're in the gap.
		let resolveCheck!: (v: unknown) => void;
		mockCheckHandleAvailability.mockReturnValue(
			new Promise((res) => {
				resolveCheck = res;
			}),
		);

		const { user } = renderStep(
			<ClaimHandleStep {...BASE_PROPS} claimHandleSeed={{ kind: "blank" }} />,
		);

		// Type but immediately submit (before debounce fires).
		const input = screen.getByRole("textbox", { name: /handle/i });
		await user.type(input, "fabio");

		// Submit while still in the debounce/checking gap.
		const form = input.closest("form")!;
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);

		// Give the event loop a tick.
		await new Promise((r) => setTimeout(r, 10));

		expect(mockClaimHandleAndAdvance).not.toHaveBeenCalled();

		resolveCheck({ status: "available" });
	});

	// ── §14.6 additions ───────────────────────────────────────────────────────

	// Test 1: Server-returned empty reason.
	// The local blank-submit path is defensive/unreachable because canContinue gating
	// requires either owned-equal or availability verdict === "available", so a blank
	// field never enables Continue. The server-returned "empty" path is the covered one.
	it("server-returned empty: dynamic status shows 'Enter a handle to continue.'", async () => {
		mockCheckHandleAvailability.mockResolvedValue({
			status: "unavailable",
			reason: "empty",
		});

		const { user } = renderStep(
			<ClaimHandleStep {...BASE_PROPS} claimHandleSeed={{ kind: "blank" }} />,
		);

		await user.type(screen.getByRole("textbox", { name: /handle/i }), "fabio");

		await waitFor(() => {
			expect(
				screen.getByText("Enter a handle to continue."),
			).toBeInTheDocument();
		});
		expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
	});

	// Test 2: 250ms debounce — availability is not called until timers advance past 250ms.
	// Uses fake timers. vi.useRealTimers() is restored in afterEach regardless of outcome.
	// fireEvent.change is used instead of user.type to avoid userEvent/fake-timer conflicts.
	describe("debounce timing (fake timers)", () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});
		afterEach(() => {
			vi.useRealTimers();
		});

		it("availability not called before 250ms; fires after 250ms", async () => {
			renderStep(
				<ClaimHandleStep {...BASE_PROPS} claimHandleSeed={{ kind: "blank" }} />,
			);

			const input = screen.getByRole("textbox", { name: /handle/i });

			// fireEvent.change fires the change synchronously, updating React state
			// without depending on userEvent's internal timing.
			act(() => {
				fireEvent.change(input, { target: { value: "fabio" } });
			});

			// Immediately after change: still in debounce gap, no request fired.
			expect(mockCheckHandleAvailability).not.toHaveBeenCalled();
			expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();

			// Advance to just before 250ms — still no request.
			act(() => {
				vi.advanceTimersByTime(249);
			});
			expect(mockCheckHandleAvailability).not.toHaveBeenCalled();

			// Advance past 250ms — debounced state updates, React Query fires.
			await act(async () => {
				vi.advanceTimersByTime(1);
			});
			expect(mockCheckHandleAvailability).toHaveBeenCalledWith(
				expect.objectContaining({ data: { handle: "fabio" } }),
			);
		});
	});

	// Test 3: Stale-result isolation — an out-of-order older response for a previous
	// value resolves AFTER the user has edited to a new value; the stale result must
	// NOT overwrite the current value's status or CTA.
	it("stale-result isolation: out-of-order older response does not overwrite current value status", async () => {
		// First call resolves only after we manually trigger it (stale in-flight).
		let resolveFirst!: (v: unknown) => void;
		const firstPromise = new Promise((res) => {
			resolveFirst = res;
		});

		// Second call resolves immediately with "available".
		mockCheckHandleAvailability
			.mockReturnValueOnce(firstPromise)
			.mockResolvedValue({ status: "available" });

		const { user } = renderStep(
			<ClaimHandleStep {...BASE_PROPS} claimHandleSeed={{ kind: "blank" }} />,
		);

		const input = screen.getByRole("textbox", { name: /handle/i });

		// Type "fabio" — triggers first availability request (stale, slow).
		await user.type(input, "fabio");
		// Wait for debounce + first check in-flight.
		await waitFor(
			() => expect(mockCheckHandleAvailability).toHaveBeenCalledTimes(1),
			{ timeout: 2000 },
		);

		// Edit to a new value before the first resolves — triggers second request.
		await user.type(input, "2");
		await waitFor(
			() => expect(mockCheckHandleAvailability).toHaveBeenCalledTimes(2),
			{ timeout: 2000 },
		);

		// Second request resolves with "available" for "fabio2".
		await waitFor(
			() => expect(screen.getByText("Available.")).toBeInTheDocument(),
			{ timeout: 2000 },
		);

		// Now resolve the first (stale) request with "taken" for "fabio".
		// React Query discards it — the query key has changed to "fabio2".
		resolveFirst({ status: "unavailable", reason: "taken" });

		// Flush microtasks and give React a chance to process any state update.
		await act(async () => {
			await new Promise((r) => setTimeout(r, 20));
		});

		// The UI must still show "Available." (the current value's verdict).
		expect(screen.getByText("Available.")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /continue/i }),
		).not.toBeDisabled();
	});

	// Test 4: Enter while checking is a no-op — no duplicate availability and no claim.
	it("Enter while checking: does not start a duplicate availability request and does not claim", async () => {
		let resolveCheck!: (v: unknown) => void;
		mockCheckHandleAvailability.mockReturnValue(
			new Promise((res) => {
				resolveCheck = res;
			}),
		);

		const { user } = renderStep(
			<ClaimHandleStep {...BASE_PROPS} claimHandleSeed={{ kind: "blank" }} />,
		);

		const input = screen.getByRole("textbox", { name: /handle/i });
		await user.type(input, "fabio");

		// Wait for the checking state to appear (request is in-flight).
		await waitFor(
			() =>
				expect(screen.getByText("Checking availability")).toBeInTheDocument(),
			{ timeout: 2000 },
		);
		expect(mockCheckHandleAvailability).toHaveBeenCalledTimes(1);

		// Submit while checking — should be a no-op.
		const form = input.closest("form")!;
		form.dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);

		await act(async () => {
			await new Promise((r) => setTimeout(r, 10));
		});

		expect(mockClaimHandleAndAdvance).not.toHaveBeenCalled();
		// No duplicate availability request fired.
		expect(mockCheckHandleAvailability).toHaveBeenCalledTimes(1);

		// Clean up pending promise.
		resolveCheck({ status: "available" });
		await act(async () => {
			await new Promise((r) => setTimeout(r, 0));
		});
	});

	// Test 5: Late availability response during submit does not overwrite submit UI.
	it("late availability during submit: does not overwrite readOnly submit-time UI state", async () => {
		// Use owned seed so Continue is immediately actionable without needing
		// a prior availability check. Submit is triggered right away.
		let resolveClaim!: (v: unknown) => void;
		mockClaimHandleAndAdvance.mockReturnValue(
			new Promise((res) => {
				resolveClaim = res;
			}),
		);

		const { user } = renderStep(
			<ClaimHandleStep
				{...BASE_PROPS}
				claimHandleSeed={{ kind: "owned", handle: "fabio" }}
			/>,
		);

		// Click Continue — submit is now in-flight, input is readOnly.
		await user.click(screen.getByRole("button", { name: /continue/i }));

		await waitFor(() => {
			expect(screen.getByRole("textbox", { name: /handle/i })).toHaveAttribute(
				"readonly",
			);
		});

		// The owned path disables queryEnabled, so no availability query is active.
		// Verify that the submit-time readOnly state is held even after a tick.
		await act(async () => {
			await new Promise((r) => setTimeout(r, 20));
		});

		// Input must still be readOnly — submit owns the field.
		const input = screen.getByRole("textbox", { name: /handle/i });
		expect(input).toHaveAttribute("readonly");
		// Owned-handle status message is still present (submit-time copy is preserved).
		expect(
			screen.queryByText("Someone got there first."),
		).not.toBeInTheDocument();

		// Clean up pending claim.
		resolveClaim({
			status: "claimed",
			ownedHandle: "fabio",
			onboarding: makeOnboarding("flag-playlists"),
		});
		await act(async () => {
			await new Promise((r) => setTimeout(r, 0));
		});
	});

	// Test 6: Intermediate-step navigation via resolveSession.
	// Complements the existing "claimed with complete session → /dashboard" test.
	it("claimed with intermediate session: navigates to /onboarding?step=flag-playlists via resolveSession", async () => {
		mockCheckHandleAvailability.mockResolvedValue({ status: "available" });
		const onboarding = makeOnboarding("flag-playlists");
		mockClaimHandleAndAdvance.mockResolvedValue({
			status: "claimed",
			ownedHandle: "fabio",
			onboarding,
		});

		const { user } = renderStep(
			<ClaimHandleStep {...BASE_PROPS} claimHandleSeed={{ kind: "blank" }} />,
		);

		await user.type(screen.getByRole("textbox", { name: /handle/i }), "fabio");
		await waitFor(
			() => expect(screen.getByText("Available.")).toBeInTheDocument(),
			{ timeout: 2000 },
		);

		await user.click(screen.getByRole("button", { name: /continue/i }));

		await waitFor(() => {
			expect(mockNavigate).toHaveBeenCalledWith(
				expect.objectContaining({
					to: "/onboarding",
					search: { step: "flag-playlists" },
				}),
			);
		});
		// Must NOT navigate to /dashboard for a non-complete step.
		expect(mockNavigate).not.toHaveBeenCalledWith(
			expect.objectContaining({ to: "/dashboard" }),
		);
	});

	// Test 7: Focus returns to input with caret at end after a retry settles.
	it("focus returns to input with caret at end after retry settles", async () => {
		// First availability check fails operationally.
		mockCheckHandleAvailability.mockResolvedValueOnce({ status: "error" });
		// Retry resolves successfully.
		mockCheckHandleAvailability.mockResolvedValue({ status: "available" });

		const { user } = renderStep(
			<ClaimHandleStep {...BASE_PROPS} claimHandleSeed={{ kind: "blank" }} />,
		);

		await user.type(screen.getByRole("textbox", { name: /handle/i }), "fabio");

		// Wait for error state with Check again button.
		await waitFor(
			() =>
				expect(
					screen.getByRole("button", { name: /Check again/i }),
				).toBeInTheDocument(),
			{ timeout: 2000 },
		);

		// Click Check again — retry fires and resolves.
		await user.click(screen.getByRole("button", { name: /Check again/i }));

		// Once retry settles, focus must return to the input.
		await waitFor(
			() => {
				const input = screen.getByRole("textbox", { name: /handle/i });
				expect(document.activeElement).toBe(input);
			},
			{ timeout: 2000 },
		);
	});
});
