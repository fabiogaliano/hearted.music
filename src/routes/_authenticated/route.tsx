/**
 * /_authenticated - Layout for authenticated routes.
 *
 * Provides: auth protection, onboarding redirect, sidebar layout.
 * Children access via Route.useRouteContext():
 *   - session: { accountId }
 *   - account: { display_name, email, ... }
 *   - theme: ThemeColor
 *
 * Performance: Auth + onboarding data are cached in TanStack Query.
 * On first entry (cause === "enter"), we fetch and cache both.
 * On subsequent navigations (cause === "stay"), we read from the
 * query cache synchronously — zero server round-trips.
 * Cache invalidates on logout (full page reload) or via
 * queryClient.invalidateQueries().
 */

import { lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { Sidebar } from "./-components/Sidebar";
import { usePostPurchaseReturn } from "@/features/billing/hooks/usePostPurchaseReturn";
import {
	resolveStep,
	isPathAllowed,
	type OnboardingMode,
	type WalkthroughSong,
} from "@/features/onboarding/step-resolver";
import { billingKeys } from "@/features/billing/query-keys";
import { matchingSessionQueryOptions } from "@/features/matching/queries";
import { useActiveJobCompletionEffects } from "@/lib/hooks/useActiveJobs";
import { getDisplayBalance, getPlanLabel } from "@/lib/domains/billing/display";
import type { BillingState } from "@/lib/domains/billing/state";
import { requireAuthSession } from "@/lib/server/auth.functions";
import { getBillingState } from "@/lib/server/billing.functions";
import { getOnboardingData } from "@/lib/server/onboarding.functions";
import { AuthenticatedThemeProvider } from "@/lib/theme/authenticated-theme";
import { useTheme } from "@/lib/theme/ThemeHueProvider";
import { DEFAULT_THEME } from "@/lib/theme/types";

const shouldLoadDevWorkflowPanel =
	import.meta.env.DEV && import.meta.env.MODE !== "test";

const DevWorkflowPanel = shouldLoadDevWorkflowPanel
	? lazy(() =>
			import("@/features/devtools/workflow-panel/DevWorkflowPanel").then(
				(m) => ({ default: m.DevWorkflowPanel }),
			),
		)
	: null;

const authQueryKey = ["auth", "session"] as const;
const onboardingQueryKey = ["auth", "onboarding"] as const;

export const Route = createFileRoute("/_authenticated")({
	beforeLoad: async ({ location, cause, context }) => {
		const { queryClient } = context;

		const { session, account } = await queryClient.ensureQueryData({
			queryKey: authQueryKey,
			queryFn: () => requireAuthSession(),
			staleTime: 5 * 60 * 1000,
		});

		const onboarding = await queryClient.ensureQueryData({
			queryKey: onboardingQueryKey,
			queryFn: () => getOnboardingData(),
			staleTime: cause === "enter" ? 0 : 5 * 60 * 1000,
		});

		let onboardingMode: OnboardingMode;
		let walkthroughSong: WalkthroughSong | null = null;

		if (onboarding.isComplete) {
			onboardingMode = "complete";
		} else {
			const resolved = resolveStep(onboarding.currentStep);
			onboardingMode = resolved.onboardingMode;
			walkthroughSong = onboarding.walkthroughSong;

			if (!isPathAllowed(location.pathname, resolved)) {
				if (resolved.allowedPath === "/onboarding") {
					throw redirect({
						to: "/onboarding",
						search: { step: onboarding.currentStep },
					});
				}
				throw redirect({ to: resolved.allowedPath });
			}
		}

		const billingState = await queryClient.ensureQueryData({
			queryKey: billingKeys.state,
			queryFn: () => getBillingState(),
			staleTime: 5 * 60 * 1000,
		});

		return {
			session,
			account,
			theme: onboarding.theme,
			billingState,
			onboardingMode,
			walkthroughSong,
		};
	},
	component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
	const {
		theme: themeColor,
		account,
		session,
		billingState,
		onboardingMode,
	} = Route.useRouteContext();

	const isComplete = onboardingMode === "complete";

	useActiveJobCompletionEffects(session.accountId, isComplete);
	usePostPurchaseReturn(session.accountId, billingState);

	const { data: matchingSession } = useQuery(
		matchingSessionQueryOptions(session.accountId),
	);
	const pendingSuggestions = matchingSession?.totalSongs ?? 0;

	const devPanel = DevWorkflowPanel ? (
		<Suspense fallback={null}>
			<DevWorkflowPanel />
		</Suspense>
	) : null;

	return (
		<AuthenticatedThemeProvider initialThemeColor={themeColor ?? DEFAULT_THEME}>
			{isComplete ? (
				<AuthenticatedShell
					account={account}
					billingState={billingState}
					pendingSuggestions={pendingSuggestions}
					devPanel={devPanel}
				/>
			) : (
				<>
					<Outlet />
					{devPanel}
				</>
			)}
		</AuthenticatedThemeProvider>
	);
}

function AuthenticatedShell({
	account,
	billingState,
	pendingSuggestions,
	devPanel,
}: {
	account: Awaited<ReturnType<typeof requireAuthSession>>["account"] | null;
	billingState: BillingState;
	pendingSuggestions: number;
	devPanel: React.ReactNode;
}) {
	const theme = useTheme();

	return (
		<div
			className="flex min-h-screen"
			style={{
				background: theme.bg,
				color: theme.text,
			}}
		>
			<Sidebar
				unsortedCount={pendingSuggestions}
				userName={account?.display_name ?? account?.email ?? null}
				userPlan={getPlanLabel(billingState)}
				userBalance={getDisplayBalance(billingState)}
				userImageUrl={account?.image_url}
			/>
			<main className="flex-1 p-8">
				<Outlet />
			</main>
			{devPanel}
		</div>
	);
}
