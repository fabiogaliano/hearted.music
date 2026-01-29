/**
 * /dashboard - Authenticated app home
 *
 * Entry point for logged-in users. Checks onboarding completion:
 * - Incomplete onboarding → redirect to /onboarding
 * - Complete → show dashboard
 *
 * Auth is handled by parent _authenticated layout.
 */

import { createFileRoute, redirect } from "@tanstack/react-router";
import { getOnboardingData } from "@/lib/server/onboarding.server";
import { themes } from "@/lib/theme/colors";
import { DEFAULT_THEME } from "@/lib/theme/types";

export const Route = createFileRoute("/_authenticated/dashboard")({
	beforeLoad: async () => {
		const data = await getOnboardingData();

		if (!data.isComplete) {
			throw redirect({
				to: "/onboarding",
				search: { step: data.currentStep },
			});
		}

		return { theme: data.theme };
	},
	component: DashboardPage,
});

function DashboardPage() {
	const { theme: themeColor } = Route.useRouteContext();
	const theme = themes[themeColor ?? DEFAULT_THEME];

	return (
		<div
			className="relative min-h-screen"
			style={{ background: theme.bg, color: theme.text }}
		>
			<div className="flex items-center justify-center min-h-screen">
				<div className="text-center">
					<h1 className="text-3xl font-semibold mb-2">Dashboard</h1>
					<p style={{ color: theme.textMuted }}>
						Your music sorting home - coming soon
					</p>
				</div>
			</div>
		</div>
	);
}
