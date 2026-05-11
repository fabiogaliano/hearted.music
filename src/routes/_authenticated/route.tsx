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

import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { usePostPurchaseReturn } from "@/features/billing/hooks/usePostPurchaseReturn";
import { billingKeys } from "@/features/billing/query-keys";
import { matchingSessionQueryOptions } from "@/features/matching/queries";
import {
	isPathAllowed,
	resolveSession,
	sessionMode,
} from "@/features/onboarding/step-resolver";
import { getDisplayBalance, getPlanLabel } from "@/lib/domains/billing/display";
import type { BillingState } from "@/lib/domains/billing/state";
import { useActiveJobCompletionEffects } from "@/lib/hooks/useActiveJobs";
import { requireAuthSession } from "@/lib/server/auth.functions";
import { getBillingState } from "@/lib/server/billing.functions";
import { getOnboardingSession } from "@/lib/server/onboarding.functions";
import { AuthenticatedThemeProvider } from "@/lib/theme/authenticated-theme";
import { useTheme } from "@/lib/theme/ThemeHueProvider";
import { DEFAULT_THEME } from "@/lib/theme/types";
import { Sidebar } from "./-components/Sidebar";

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
const onboardingSessionQueryKey = ["auth", "onboarding-session"] as const;

export const Route = createFileRoute("/_authenticated")({
	beforeLoad: async ({ location, context }) => {
		const { queryClient } = context;

		const { session, account } = await queryClient.ensureQueryData({
			queryKey: authQueryKey,
			queryFn: () => requireAuthSession(),
			staleTime: 5 * 60 * 1000,
		});

		// Guard-critical onboarding payload — small object, always fresh. Child
		// routes read `onboardingSession` and `theme` from context; they do
		// NOT need the full page payload (playlists, landing songs, etc.),
		// which lives in `/onboarding`'s own loader. We start billing in
		// parallel, but onboarding still resolves first so redirects are not
		// blocked by billing latency or failures.
		const onboardingSessionPromise = queryClient.ensureQueryData({
			queryKey: onboardingSessionQueryKey,
			queryFn: () => getOnboardingSession(),
			staleTime: 0,
		});
		const billingStatePromise = queryClient
			.ensureQueryData({
				queryKey: billingKeys.state,
				queryFn: () => getBillingState(),
				staleTime: 5 * 60 * 1000,
			})
			.then((value) => ({ ok: true as const, value }))
			.catch((error: unknown) => ({ ok: false as const, error }));

		const { session: onboardingSession, theme } =
			await onboardingSessionPromise;

		if (onboardingSession.status !== "complete") {
			const resolved = resolveSession(onboardingSession);
			if (!isPathAllowed(location.pathname, resolved.allowedPath)) {
				if (resolved.allowedPath === "/onboarding") {
					throw redirect({
						to: "/onboarding",
						search: { step: onboardingSession.status },
					});
				}
				throw redirect({ to: resolved.allowedPath });
			}
		}

		const billingStateResult = await billingStatePromise;
		if (!billingStateResult.ok) {
			throw billingStateResult.error;
		}

		const billingState = billingStateResult.value;

		return {
			session,
			account,
			theme,
			billingState,
			onboardingSession,
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
		onboardingSession,
	} = Route.useRouteContext();

	const mode = sessionMode(onboardingSession);
	const isComplete = mode === "complete";
	const showShell = isComplete || mode === "walkthrough";

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
			{showShell ? (
				<AuthenticatedShell
					account={account}
					billingState={billingState}
					pendingSuggestions={pendingSuggestions}
					devPanel={devPanel}
					showSidebar={isComplete}
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
	showSidebar,
}: {
	account: Awaited<ReturnType<typeof requireAuthSession>>["account"] | null;
	billingState: BillingState;
	pendingSuggestions: number;
	devPanel: React.ReactNode;
	showSidebar: boolean;
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
			{showSidebar && (
				<Sidebar
					unsortedCount={pendingSuggestions}
					userName={account?.display_name ?? account?.email ?? null}
					userPlan={getPlanLabel(billingState)}
					userBalance={getDisplayBalance(billingState)}
					userImageUrl={account?.image_url}
				/>
			)}
			<main className="flex-1 p-8">
				<Outlet />
			</main>
			{devPanel}
		</div>
	);
}
