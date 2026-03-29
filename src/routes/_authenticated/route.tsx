/**
 * /_authenticated - Layout for authenticated routes.
 *
 * Provides: auth protection, onboarding redirect, sidebar layout.
 * Children access via Route.useRouteContext():
 *   - session: { accountId }
 *   - account: { display_name, email, ... }
 *   - theme: ThemeColor
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
import { requireAuthSession } from "@/lib/server/auth.functions";
import { getOnboardingData } from "@/lib/server/onboarding.functions";
import { useActiveJobCompletionEffects } from "@/lib/hooks/useActiveJobs";
import { matchingSessionQueryOptions } from "@/features/matching/queries";
import { useRegisterTheme } from "@/lib/theme/ThemeHueProvider";
import { getTheme } from "@/lib/theme/useTheme";
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

export const Route = createFileRoute("/_authenticated")({
	beforeLoad: async ({ location }) => {
		const { session, account } = await requireAuthSession();
		const onboarding = await getOnboardingData();

		// Skip onboarding check if already heading there (prevents redirect loop)
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
	const theme = getTheme(themeColor ?? DEFAULT_THEME);
	const location = useLocation();
	const isOnboarding = location.pathname.startsWith("/onboarding");

	useRegisterTheme(isOnboarding ? null : theme);

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

	if (isOnboarding) {
		return (
			<>
				<Outlet />
				{devPanel}
			</>
		);
	}

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
			/>
			<main className="flex-1 p-8">
				<Outlet />
			</main>
			{devPanel}
		</div>
	);
}
