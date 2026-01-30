/**
 * /dashboard - Authenticated app home
 *
 * Entry point for logged-in users. Checks onboarding completion:
 * - Incomplete onboarding → redirect to /onboarding
 * - Complete → show dashboard shell with child routes
 *
 * Auth is handled by parent _authenticated layout.
 */

import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { getOnboardingData } from "@/lib/server/onboarding.server";
import { getDashboardData } from "@/lib/server/dashboard.server";
import { Dashboard } from "@/features/dashboard/Dashboard";

export const Route = createFileRoute("/_authenticated/dashboard")({
	beforeLoad: async () => {
		const onboardingData = await getOnboardingData();

		if (!onboardingData.isComplete) {
			throw redirect({
				to: "/onboarding",
				search: { step: onboardingData.currentStep },
			});
		}

		const dashboardData = await getDashboardData();
		return { dashboardData };
	},
	component: DashboardLayout,
});

function DashboardLayout() {
	const { dashboardData } = Route.useRouteContext();

	return (
		<Dashboard data={dashboardData}>
			<Outlet />
		</Dashboard>
	);
}
