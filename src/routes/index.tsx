/**
 * / - Public Landing Page
 *
 * Routing logic:
 * - Not logged in: Show landing + login button
 * - Logged in: Redirect to /dashboard (which handles onboarding check)
 */
import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { Landing } from "@/features/landing/Landing";
import { getAuthSession } from "@/lib/auth.server";
import { themes } from "@/lib/theme/colors";
import { useRegisterTheme } from "@/lib/theme/ThemeHueProvider";
import { DEFAULT_THEME } from "@/lib/theme/types";

const checkAuth = createServerFn({ method: "GET" }).handler(async () => {
	const session = await getAuthSession();
	return { authenticated: session !== null };
});

export const Route = createFileRoute("/")({
	beforeLoad: async () => {
		const result = await checkAuth();

		if (result.authenticated) {
			throw redirect({ to: "/dashboard" });
		}
	},
	component: LandingPage,
});

function LandingPage() {
	const theme = themes[DEFAULT_THEME];

	useRegisterTheme(theme);

	return (
		<div className="relative min-h-screen" style={{ background: theme.bg }}>
			<Landing featuredSongIndex={0} isReleased={true} />
		</div>
	);
}
