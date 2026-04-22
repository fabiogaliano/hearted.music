/**
 * Tests for PlanSelectionStep's billing-disabled reconciliation.
 *
 * Regression guard: a previously persisted checkout intent must not keep the
 * polling hook active when billing is disabled, otherwise the polling timeout
 * can flip success UI back to retry.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SONG_PACK_500 } from "@/lib/domains/billing/offers";
import type { PlanSelectionConfig } from "@/lib/server/billing.functions";
import { setupShortcutMock } from "@/test/mocks";
import { render, screen, waitFor } from "@/test/utils/render";
import type { CheckoutIntent } from "../checkout-intent";
import type { CheckoutPollingState } from "../hooks/useCheckoutPolling";
import { PlanSelectionStep } from "../components/PlanSelectionStep";

const INTENT_STORAGE_KEY = "hearted:checkout-intent:v2";

const mockGetPlanSelectionConfig = vi.fn();
const mockGetBillingState = vi.fn();
const mockCreateCheckoutSession = vi.fn();
const mockMarkOnboardingComplete = vi.fn();

let controlledPollingState: CheckoutPollingState | null = null;
const useCheckoutPollingMock = vi.fn(
	(intent: CheckoutIntent | null): CheckoutPollingState | null =>
		intent ? controlledPollingState : null,
);

vi.mock("@/lib/keyboard/useShortcut", () => setupShortcutMock());

vi.mock("@/lib/server/billing.functions", () => ({
	getBillingState: () => mockGetBillingState(),
	getPlanSelectionConfig: () => mockGetPlanSelectionConfig(),
	createCheckoutSession: (args: unknown) => mockCreateCheckoutSession(args),
}));

vi.mock("@/lib/server/onboarding.functions", () => ({
	markOnboardingComplete: () => mockMarkOnboardingComplete(),
}));

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => vi.fn(),
}));

vi.mock("../hooks/useCheckoutPolling", () => ({
	useCheckoutPolling: (intent: CheckoutIntent | null) =>
		useCheckoutPollingMock(intent),
}));

function renderWithClient(ui: ReactElement) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: 0 } },
	});
	return render(
		<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
	);
}

describe("PlanSelectionStep — billing disabled with persisted intent", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		sessionStorage.clear();
		controlledPollingState = null;
		mockGetBillingState.mockResolvedValue({
			creditBalance: 0,
			hasUnlimited: false,
		});
	});

	it("clears persisted intent and stays on success even if polling later times out", async () => {
		sessionStorage.setItem(
			INTENT_STORAGE_KEY,
			JSON.stringify({
				kind: "pack",
				offer: SONG_PACK_500,
				checkoutAttemptId: "attempt-1",
				baselineCreditBalance: 0,
			}),
		);

		const config: PlanSelectionConfig = {
			billingEnabled: false,
			quarterlyPlanEnabled: false,
		};
		mockGetPlanSelectionConfig.mockResolvedValue(config);

		renderWithClient(
			<PlanSelectionStep
				syncStats={{ songs: 250, playlists: 8 }}
				readyCopyVariant="free"
			/>,
		);

		// Success view appears once config resolves.
		expect(await screen.findByText(/Start Exploring/i)).toBeInTheDocument();

		// Persisted intent is cleared so the polling hook will see null.
		await waitFor(() => {
			expect(sessionStorage.getItem(INTENT_STORAGE_KEY)).toBeNull();
		});

		// Proves pendingIntent was nulled: useCheckoutPolling was invoked with null.
		await waitFor(() => {
			expect(useCheckoutPollingMock).toHaveBeenCalledWith(null);
		});

		// Regression guard: even if a timeout bubbles up from whatever polling run
		// was already in flight, the success UI must not flip to retry because
		// pendingIntent is null and useCheckoutPolling now returns null.
		controlledPollingState = { status: "timeout" };

		// Retry copy must never appear.
		expect(screen.queryByText(/Retry confirmation/i)).not.toBeInTheDocument();
		expect(screen.queryByText(/Almost there\./i)).not.toBeInTheDocument();
		expect(screen.getByText(/Start Exploring/i)).toBeInTheDocument();
	});

	it("does not clear intent when billing is enabled (checkout-return path preserved)", async () => {
		const persistedIntent = {
			kind: "pack" as const,
			offer: SONG_PACK_500,
			checkoutAttemptId: "attempt-2",
			baselineCreditBalance: 0,
		};
		sessionStorage.setItem(INTENT_STORAGE_KEY, JSON.stringify(persistedIntent));

		const config: PlanSelectionConfig = {
			billingEnabled: true,
			quarterlyPlanEnabled: false,
		};
		mockGetPlanSelectionConfig.mockResolvedValue(config);

		// Keep polling in-flight so nothing transitions on its own.
		controlledPollingState = { status: "polling" };

		renderWithClient(
			<PlanSelectionStep
				syncStats={{ songs: 250, playlists: 8 }}
				readyCopyVariant="free"
			/>,
		);

		// Polling view (not retry, not success) while we're confirming.
		expect(
			await screen.findByText(/Confirming your purchase/i),
		).toBeInTheDocument();

		// Intent is preserved for the in-flight checkout-return flow.
		expect(sessionStorage.getItem(INTENT_STORAGE_KEY)).not.toBeNull();
	});
});
