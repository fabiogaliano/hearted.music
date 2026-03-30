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
import {
	createFileRoute,
	Outlet,
	redirect,
	useLocation,
} from "@tanstack/react-router";
import { Sidebar } from "./-components/Sidebar";
import { matchingSessionQueryOptions } from "@/features/matching/queries";
import { useActiveJobCompletionEffects } from "@/lib/hooks/useActiveJobs";
import { requireAuthSession } from "@/lib/server/auth.functions";
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

		const isOnboardingRoute = location.pathname.startsWith("/onboarding");

		if (!onboarding.isComplete && !isOnboardingRoute) {
			throw redirect({
				to: "/onboarding",
				search: { step: onboarding.currentStep },
			});
		}

		return { session, account, theme: onboarding.theme };
	},
	component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
	const { theme: themeColor, account, session } = Route.useRouteContext();
	const location = useLocation();
	const isOnboarding = location.pathname.startsWith("/onboarding");

	useActiveJobCompletionEffects(session.accountId, !isOnboarding);

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
			{isOnboarding ? (
				<>
					<Outlet />
					{devPanel}
				</>
			) : (
				<AuthenticatedShell
					account={account}
					pendingSuggestions={pendingSuggestions}
					devPanel={devPanel}
				/>
			)}
		</AuthenticatedThemeProvider>
	);
}

function AuthenticatedShell({
	account,
	pendingSuggestions,
	devPanel,
}: {
	account: Awaited<ReturnType<typeof requireAuthSession>>["account"] | null;
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
				userPlan="Free Plan"
				userImageUrl={account?.image_url}
			/>
			<main className="flex-1 p-8">
				<Outlet />
			</main>
			{devPanel}
		</div>
	);
}
