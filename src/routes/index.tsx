/**
 * / - Public Landing Page
 *
 * Routing logic:
 * - Not logged in: Show landing + login button
 * - Logged in: Redirect to /dashboard (which handles onboarding check)
 */
import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { Landing } from "@/features/landing/Landing";
import { getShuffledLandingData } from "@/lib/content/landing/landing-songs.server";
import { getAuthSession } from "@/lib/platform/auth/auth.server";
import { returnPathSchema } from "@/lib/platform/auth/return-path";

const checkAuth = createServerFn({ method: "GET" }).handler(async () => {
	const session = await getAuthSession();
	return { authenticated: session !== null };
});

const loadLandingData = createServerFn({ method: "GET" }).handler(async () => {
	return getShuffledLandingData();
});

export const Route = createFileRoute("/")({
	validateSearch: z.object({ redirect: returnPathSchema }),
	beforeLoad: async () => {
		const result = await checkAuth();

		if (result.authenticated) {
			throw redirect({ to: "/dashboard" });
		}
	},
	loader: () => loadLandingData(),
	component: LandingPage,
});

function LandingPage() {
	const { manifest, initialDetail } = Route.useLoaderData();

	return (
		<div className="theme-bg relative min-h-screen">
			<Landing
				initialManifest={manifest}
				initialDetail={initialDetail}
				isReleased={true}
			/>
		</div>
	);
}
