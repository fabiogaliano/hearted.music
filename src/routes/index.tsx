/**
 * / - Public Landing Page
 *
 * Routing logic:
 * - Not logged in: Show landing + login button
 * - Logged in: Redirect to /dashboard (which handles onboarding check)
 */
import { createFileRoute, redirect } from "@tanstack/react-router";
import { Landing } from "@/features/landing/Landing";
import { checkAuth } from "@/lib/auth/guards";
import { themes } from "@/lib/theme/colors";
import { DEFAULT_THEME } from "@/lib/theme/types";

export const Route = createFileRoute("/")({
	beforeLoad: async () => {
		const result = await checkAuth();

		if (result.status === "authenticated") {
			throw redirect({ to: "/dashboard" });
		}
	},
	component: LandingPage,
});

function LandingPage() {
	const theme = themes[DEFAULT_THEME];

	return (
		<div className="relative min-h-screen" style={{ background: theme.bg }}>
			<Landing theme={theme} featuredSongIndex={0} isReleased={true} />
		</div>
	);
}
