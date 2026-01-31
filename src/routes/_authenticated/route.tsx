/**
 * /_authenticated - Layout for authenticated routes.
 *
 * Provides: auth protection, onboarding redirect, sidebar layout.
 * Children access via Route.useRouteContext():
 *   - session: { accountId }
 *   - account: { display_name, email, ... }
 *   - theme: ThemeColor
 */

import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { Sidebar } from "./-components/Sidebar";
import { requireAuth } from "@/lib/auth/guards";
import { getOnboardingData } from "@/lib/server/onboarding.server";
import { getTheme } from "@/lib/theme/useTheme";
import { DEFAULT_THEME } from "@/lib/theme/types";

export const Route = createFileRoute("/_authenticated")({
	beforeLoad: async ({ location }) => {
		const { session, account } = await requireAuth();
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
	const { theme: themeColor, account } = Route.useRouteContext();
	const theme = getTheme(themeColor ?? DEFAULT_THEME);

	return (
		<div
			className="flex min-h-screen"
			style={{ background: theme.bg, color: theme.text }}
		>
			<Sidebar
				theme={theme}
				unsortedCount={5}
				userName={account?.display_name ?? account?.email ?? null}
				userPlan="Free Plan"
			/>
			<main className="flex-1 p-8">
				<Outlet />
			</main>
		</div>
	);
}
